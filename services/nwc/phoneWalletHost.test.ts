import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
  type Event,
} from 'nostr-tools';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { approveWithPhoneWalletPasskey } from '../phoneWalletPasskey';
import {
  onPhoneBackground,
  invalidatePhoneApprovals,
  pairPhone,
  phonePairInfo,
  revokePhonePair,
  selectPhoneWallet,
} from './phoneWalletHost';
import { PHONE_RELAY, nowSeconds } from './phoneWalletProtocol';

const mockEvents: Event[] = [];
let mockReceive: (event: Event) => void;
let mockNext: ((event: Event) => void) | undefined;
const nextReply = () =>
  new Promise<Event>((resolve) => {
    mockNext = resolve;
  });
jest.mock('nostr-tools', () => ({
  ...jest.requireActual('nostr-tools'),
  SimplePool: class {
    publish(_relay: string[], event: Event) {
      mockEvents.push(event);
      mockNext?.(event);
      mockNext = undefined;
      return [Promise.resolve('ok')];
    }
    subscribeMany(_relays: string[], _filter: unknown, opts: { onevent: typeof mockReceive }) {
      mockReceive = opts.onevent;
      return { close() {} };
    }
    close() {}
  },
}));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
jest.mock('../appLockState', () => ({ isAppUnlocked: () => true }));
jest.mock('../phoneWalletPasskey', () => ({
  hasPhoneWalletPasskey: jest.fn(async () => true),
  enrollPhoneWalletPasskey: jest.fn(),
  approveWithPhoneWalletPasskey: jest.fn(),
}));
const mockWallet = { isUnlocked: true, activeWallet: { id: 1, encrypted_mnemonic: 'seed' } };
let mockRgbConnecting = false;
jest.mock('../../store/storeProvider', () => ({
  getStore: () => ({
    getState: () => ({ wallet: mockWallet }),
  }),
}));
jest.mock('../protocols/rgbL1WalletKey', () => ({ rgbL1WalletKey: () => 'owner' }));
const mockAccount = { ownerKey: 'owner', network: 'signet' };
jest.mock('../protocols/wdk', () => ({ isRgbConnecting: () => mockRgbConnecting }));
jest.mock('../protocols', () => ({
  rgbAccountIsOnDevice: () => true,
  protocolManager: { getAdapterIfAvailable: () => ({ account: mockAccount, isConnected: () => true }) },
}));
const mockPayment = jest.fn<Promise<{ state: string } | null>, []>(async () => null);
jest.mock('../DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({ browserPayment: mockPayment }) },
}));

test('pair, authenticate replies, reload and revoke a browser without sending its secret to the phone', async () => {
  const saved = new Map<string, string>();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (k) => saved.get(k) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (k, v) => {
    saved.set(k, v);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (k) => {
    saved.delete(k);
  });
  const sk = generateSecretKey();
  const client = getPublicKey(sk);
  const nonce = '4'.repeat(32);
  const expiry = nowSeconds() + 200;
  await selectPhoneWallet(1);
  const invitation = `kaleidoswap://pair?version=1&client=${client}&relay=${encodeURIComponent(PHONE_RELAY)}&nonce=${nonce}&expires=${expiry}`;
  mockWallet.isUnlocked = false;
  await expect(pairPhone(invitation, 1)).rejects.toMatchObject({ code: 'RESTRICTED' });
  mockWallet.isUnlocked = true;
  mockRgbConnecting = true;
  await expect(pairPhone(invitation, 1)).rejects.toMatchObject({ code: 'RESTRICTED' });
  mockRgbConnecting = false;
  expect(approveWithPhoneWalletPasskey).not.toHaveBeenCalled();
  // The Android credential sheet can background the app while it verifies its owner.
  jest.mocked(approveWithPhoneWalletPasskey).mockImplementationOnce(async () => {
    Object.assign(AppState, { currentState: 'background' });
    onPhoneBackground();
    Object.assign(AppState, { currentState: 'active' });
  });
  await pairPhone(invitation, 1);
  const reply = mockEvents.find((e) => e.kind === 4147)!;
  expect(verifyEvent(reply)).toBe(true);
  const wallet = reply.pubkey;
  const shared = nip44.getConversationKey(sk, wallet);
  expect(JSON.parse(nip44.decrypt(reply.content, shared))).toEqual({
    version: 1,
    nonce,
    wallet,
    network: 'signet',
  });
  expect(approveWithPhoneWalletPasskey).toHaveBeenCalledWith('owner', expect.stringContaining(nonce));
  expect(reply.tags).toContainEqual(['expiration', String(expiry)]);
  expect(mockEvents.find((e) => e.kind === 13194)?.tags).toContainEqual(['encryption', 'nip44_v2']);
  await selectPhoneWallet(undefined);
  await selectPhoneWallet(1);
  expect(phonePairInfo()).toMatchObject({ client, network: 'signet' });
  const req = finalizeEvent(
    {
      kind: 23194,
      created_at: nowSeconds(),
      tags: [
        ['p', wallet],
        ['encryption', 'nip44_v2'],
      ],
      content: nip44.encrypt(
        JSON.stringify({ method: 'kaleido_rgb_payment_status', params: { payment_id: nonce } }),
        shared,
      ),
    },
    sk,
  );
  const receive = mockReceive;
  const first = nextReply();
  receive(req);
  const response = await first;
  expect(verifyEvent(response)).toBe(true);
  expect(response.tags).toContainEqual(['e', req.id]);
  expect(JSON.parse(nip44.decrypt(response.content, shared)).result).toEqual({ status: 'not_found' });
  const count = mockEvents.length;
  receive({ ...JSON.parse(JSON.stringify(req)), id: 'f'.repeat(64), sig: '0'.repeat(128) });
  expect(mockEvents).toHaveLength(count);
  Object.assign(AppState, { currentState: 'background' });
  const blocked = nextReply();
  const lockedRequest = finalizeEvent(
    {
      kind: req.kind,
      tags: [...req.tags, ['nonce', 'locked']],
      created_at: req.created_at,
      content: req.content,
    },
    sk,
  );
  receive(lockedRequest);
  expect(JSON.parse(nip44.decrypt((await blocked).content, shared)).error.code).toBe('RESTRICTED');
  // A delayed replay of a claimed spend cannot become a definitive refusal,
  // even if the app is locked or the request has now expired.
  mockPayment.mockResolvedValueOnce({ state: 'unknown' });
  const retry = nextReply();
  const expired = nowSeconds() - 1;
  receive(
    finalizeEvent(
      {
        kind: 23194,
        created_at: nowSeconds() - 10,
        tags: [
          ['p', wallet],
          ['encryption', 'nip44_v2'],
          ['expiration', String(expired)],
        ],
        content: nip44.encrypt(
          JSON.stringify({
            method: 'kaleido_pay_rgb_invoice',
            params: { payment_id: nonce, invoice: 'rgb:test', expires_at: expired },
          }),
          shared,
        ),
      },
      sk,
    ),
  );
  expect(JSON.parse(nip44.decrypt((await retry).content, shared)).error.code).toBe('OTHER');
  Object.assign(AppState, { currentState: 'active' });
  await revokePhonePair(1);
  await selectPhoneWallet(1);
  expect(phonePairInfo()).toBeNull();
  const revoked = mockEvents.length;
  receive(req);
  expect(mockEvents).toHaveLength(revoked);
  // A real app lock while the OS sheet is displayed always invalidates pairing.
  jest.mocked(approveWithPhoneWalletPasskey).mockImplementationOnce(async () => {
    invalidatePhoneApprovals();
  });
  const fresh = `kaleidoswap://pair?version=1&client=${client}&relay=${encodeURIComponent(PHONE_RELAY)}&nonce=${nonce}&expires=${nowSeconds() + 200}`;
  await expect(pairPhone(fresh, 1)).rejects.toMatchObject({ code: 'RESTRICTED' });
  expect(phonePairInfo()).toBeNull();
});
