import { finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent, type Event } from 'nostr-tools';
import { disconnectWebRgb, invalidateWebRgb, pairWebRgb, restoreWebRgb, setWebRgbReviewer, webRgbSessions, type WebRgbReview } from './nwc';
import { parseAuthorization, unixTime } from './nwcProtocol';

const mockSecure = new Map<string, string>();
const mockLedger = new Map<string, string>();
const mockLedgerWrite = jest.fn(async (key: string, value: string) => { mockLedger.set(key, value); });
const mockPosts: Event[] = [];
let mockReceive: (event: Event) => void;
const mockPublish = jest.fn((_relays: string[], event: Event) => { mockPosts.push(event); return [Promise.resolve('ok')]; });
const mockSubscribe = jest.fn((_r: string[], _f: unknown, handlers: { onevent(event: Event): void; oneose(): void }) => {
  mockReceive = handlers.onevent; handlers.oneose(); return { close: jest.fn() };
});
const mockSend = jest.fn(async () => ({ txid: 'tx1' }));
const mockList = jest.fn(() => [{ id: 'asset', balance: 10 }]);
const mockAccount = { network: 'mutinynet' };
let mockBinding = { account: mockAccount, key: 'one', walletName: 'Phone' };
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { mockSecure.set(key, value); },
  deleteItemAsync: async (key: string) => { mockSecure.delete(key); },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockLedger.get(key) ?? null,
  setItem: (key: string, value: string) => mockLedgerWrite(key, value),
  removeItem: async (key: string) => { mockLedger.delete(key); },
}));
jest.mock('nostr-tools', () => ({ ...jest.requireActual('nostr-tools'), SimplePool: class {
  subscribeMany = mockSubscribe; publish = mockPublish; destroy() {}
} }));
jest.mock('./account', () => ({ currentWebRgbAccount: () => mockBinding }));
jest.mock('./provider', () => ({
  webRgbMethods: () => ['listAssets', 'sendAsset', 'getAddress'],
  createWebRgbProvider: (_: unknown, ctx: { origin: string }, approve: (s: string) => Promise<void>, guard: () => void) => ({
    listAssets: mockList,
    async sendAsset() { await approve('Send 1 unit'); guard(); return mockSend(); },
  }),
}));

const secret = generateSecretKey();
const client = getPublicKey(secret);
const state = '1a'.repeat(16);
const challenge = '55'.repeat(16);
const relay = 'wss://relay.kaleidoswap.com';
const uri = (custom: Record<string, string> = {}, pk = client) => 'nostr+walletauth://' + pk + '?' + new URLSearchParams({
  relay, state, name: 'Mosa\u202eik', request_methods: 'get_info kaleido_list_assets', optional_request_methods: 'kaleido_send_asset kaleido_unsupported',
  metadata: JSON.stringify({ network: 'mutinynet', challenge }), expires_at: String(unixTime() + 1800), ...custom,
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function packet(method: string, params: object = {}, tags?: string[][], timestamp = unixTime()): Event {
  const wallet = mockPosts[0].pubkey;
  const content = nip44.v2.encrypt(JSON.stringify({ method, params }), nip44.v2.utils.getConversationKey(secret, wallet));
  return JSON.parse(JSON.stringify(finalizeEvent({ kind: 23194, created_at: timestamp,
    tags: tags ?? [['p', wallet], ['encryption', 'nip44_v2'], ['expiration', String(timestamp + 60)]], content }, secret)));
}
function response(id: string) {
  const event = mockPosts.find(item => item.kind === 23195 && item.tags.some(t => t[0] === 'e' && t[1] === id));
  return event && JSON.parse(nip44.v2.decrypt(event.content, nip44.v2.utils.getConversationKey(secret, event.pubkey)));
}
let confirm: jest.Mock<Promise<boolean>, [WebRgbReview]>;
beforeEach(() => {
  invalidateWebRgb(); jest.clearAllMocks(); mockSecure.clear(); mockLedger.clear(); mockPosts.length = 0;
  mockBinding = { account: mockAccount, key: 'one', walletName: 'Phone' };
  confirm = jest.fn(async (_review: WebRgbReview) => true);
  setWebRgbReviewer(confirm);
});
afterEach(() => invalidateWebRgb());

test('a fresh install stays offline; NWA authorizes only requested methods and proves knowledge of the private QR challenge', async () => {
  await restoreWebRgb(); expect(mockSubscribe).not.toHaveBeenCalled();
  await pairWebRgb(uri());
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mosaik', url: 'nostr:' + client, details: expect.arrayContaining(['mutinynet', 'kaleido_send_asset']) }));
  const event = mockPosts[0];
  expect(verifyEvent(event)).toBe(true);
  expect(event.kind).toBe(13194);
  expect(event.content.split(' ')).toEqual(['get_info', 'kaleido_list_assets', 'kaleido_send_asset']);
  expect(event.tags).toEqual(expect.arrayContaining([['p', client], ['state', state], ['encryption', 'nip44_v2'], ['extensions', '08']]));
  const proof = event.tags.find(t => t[0] === 'proof')![1];
  expect(JSON.parse(nip44.v2.decrypt(proof, nip44.v2.utils.getConversationKey(secret, event.pubkey)))).toEqual({ challenge });
  expect(webRgbSessions()).toEqual([{ topic: client, url: 'nostr:' + client, name: 'Mosaik' }]);
  const info = packet('get_info'); const list = packet('kaleido_list_assets', { args: [] }); const forbidden = packet('kaleido_get_address', { args: [] });
  [info, list, forbidden].forEach(mockReceive); await flush();
  expect(response(info.id).result).toMatchObject({ network: 'signet', rgb_network: 'mutinynet', methods: event.content.split(' '), extensions: ['08'] });
  expect(response(list.id).result).toEqual({ value: mockList() });
  expect(response(forbidden.id).error.code).toBe('RESTRICTED');
});

test('accepts a wallet-specific NWA QR and waits for an installed relay subscription before advertising the grant or finishing restore', async () => {
  let acknowledge!: () => void;
  const deferSubscription = () => mockSubscribe.mockImplementationOnce((_relays, _filter, handlers) => {
    mockReceive = handlers.onevent; acknowledge = handlers.oneose; return { close: jest.fn() };
  });
  deferSubscription();
  const pairing = pairWebRgb(uri().replace('walletauth:', 'walletauth+kaleidoswap:'));
  await flush(); expect(mockPosts).toHaveLength(0);
  acknowledge(); await pairing; expect(mockPosts).toHaveLength(1);
  invalidateWebRgb(); deferSubscription();
  const ready = jest.fn(); const restoring = restoreWebRgb().then(ready);
  await flush(); expect(ready).not.toHaveBeenCalled(); acknowledge(); await restoring; expect(ready).toHaveBeenCalled();
});

test('persists each mutation before confirmation and ignores duplicates during execution and across suspend/restore', async () => {
  await pairWebRgb(uri());
  const tx = packet('kaleido_send_asset', { args: [{ invoice: 'rgb:test' }] });
  mockReceive(tx); mockReceive(tx); await flush();
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockLedgerWrite.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[1]);
  expect(response(tx.id).result.value.txid).toBe('tx1');
  invalidateWebRgb(); await restoreWebRgb();
  mockReceive(tx); await flush(); expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockPosts.filter(e => e.kind === 23195)).toHaveLength(1);
  mockLedgerWrite.mockRejectedValueOnce(new Error('disk unavailable'));
  const other = packet('kaleido_send_asset', { args: [{}] }); mockReceive(other); await flush();
  expect(mockSend).toHaveBeenCalledTimes(1); expect(response(other.id).error.code).toBe('INTERNAL');
});

test('rejects stale, misaddressed, forged and unencrypted requests before touching the wallet', async () => {
  await pairWebRgb(uri());
  const tx = packet('kaleido_send_asset', { args: [{}] });
  const stale = packet('kaleido_send_asset', { args: [{}] }, undefined, unixTime() - 180);
  const wrong = (tags: string[][]) => packet('kaleido_send_asset', { args: [{}] }, tags);
  const cases = [stale, { ...tx, sig: '0'.repeat(128) }, wrong([...tx.tags, ['p', client]]), wrong(tx.tags.filter(t => t[0] !== 'expiration')),
    wrong(tx.tags.map(t => t[0] === 'encryption' ? ['encryption', 'nip04'] : t)), wrong(tx.tags.map(t => t[0] === 'expiration' ? ['expiration', String(unixTime() + 350)] : t))];
  cases.forEach(mockReceive); await flush();
  expect(mockLedgerWrite).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled(); expect(mockPosts).toHaveLength(1);
});

test('declining or locking while approving never signs; revoking prevents restore and an alternate local wallet cannot restore the grant', async () => {
  await pairWebRgb(uri());
  confirm.mockResolvedValueOnce(false);
  const refused = packet('kaleido_send_asset', { args: [{}] }); mockReceive(refused); await flush();
  expect(response(refused.id).error.code).toBe('RESTRICTED');
  let finish!: (accept: boolean) => void;
  confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const interrupted = packet('kaleido_send_asset', { args: [{}] }); mockReceive(interrupted); await flush();
  const review = confirm.mock.calls.at(-1)![0];
  invalidateWebRgb(); expect(review.signal.aborted).toBe(true); finish(true); await flush();
  expect(mockSend).not.toHaveBeenCalled();
  mockBinding = { ...mockBinding, key: 'two' }; await restoreWebRgb(); expect(webRgbSessions()).toEqual([]);
  mockBinding = { ...mockBinding, key: 'one' }; await restoreWebRgb(); expect(webRgbSessions()).toHaveLength(1);
  await disconnectWebRgb(client); await restoreWebRgb(); expect(webRgbSessions()).toEqual([]);
});

test('refuses overlapping or replacement grants and displays no secret after a relay failure', async () => {
  confirm.mockResolvedValueOnce(false);
  await expect(pairWebRgb(uri())).rejects.toThrow('declined'); expect(mockSecure.size).toBe(0);
  const pair = pairWebRgb(uri()); await expect(pairWebRgb(uri())).rejects.toThrow('being reviewed'); await pair;
  await expect(pairWebRgb(uri({ state: 'ff'.repeat(16) }))).rejects.toThrow('Disconnect');
  mockPublish.mockImplementationOnce(() => [Promise.reject(new Error('transport private metadata'))]);
  await expect(pairWebRgb(uri())).rejects.toThrow('scan the same QR');
  await pairWebRgb(uri()); expect(mockSecure.size).toBe(1); expect(confirm).toHaveBeenCalledTimes(2);
});

const invalidRestrictions: Record<string, string>[] = [{ request_methods: 'pay_invoice' }, { expires_at: '0' }, { max_amount: '100' },
  { state: '1' }, { relay: 'http://example.org' }, { metadata: '{"network":"signet"}' }, { metadata: '{"challenge":"bad"}' }];
test.each(invalidRestrictions)('rejects malformed or unsupported QR restrictions %o', options => {
  expect(() => parseAuthorization(uri(options), 'mutinynet', ['listAssets'])).toThrow();
});
