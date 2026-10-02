jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockStatus = jest.fn().mockResolvedValue({ status: 'pending' });
const mockQuoteOptions = jest.fn();
const mockExecute = jest.fn().mockResolvedValue({ status: 'pending', reference: 'swap-1' });
jest.mock('./electrumSwapAccount', () => ({
  createElectrumSwapAccount: ({ source }: any) => ({
    source, swaps: [], providerNames: {}, quoteOptions: mockQuoteOptions,
    execute: (...a: any[]) => mockExecute(...a), status: mockStatus,
  }),
}));
jest.mock('./recovery', () => ({ kaleidoPayStores: {} }));
import { encodeOffer } from '@universal-bolt12/universal-code';
import { barkRail, connectBarkToKaleidoPay, createBarkArkAccount, createBarkOnchainAccount, createBarkPayAccount, disconnectBarkFromKaleidoPay } from './bark';
import { offerRails } from '@universal-bolt12/universal-code';

const now = () => Math.floor(Date.now() / 1000);
const swapRoute = { kind: 'swap', sourceId: 'bark', from: 'ln:signet', to: 'btc:signet', providerId: 'electrum-nostr' } as any;
const directRoute = { kind: 'direct', sourceId: 'bark', from: 'ln:signet', to: 'ln:signet' } as any;
const amountOffer = encodeOffer([{ type: 8n, value: new Uint8Array([0x4c, 0x4b, 0x40]) }, { type: 10n, value: new TextEncoder().encode('Coffee') }]); // 5,000,000 msat
const openOffer = encodeOffer([{ type: 10n, value: new TextEncoder().encode('Tip') }]);
const preview = (offer: string, amountSat = 5000) => ({ code: { offer }, request: { id: 'r', network: 'signet', amountSat, acceptedRails: ['ln'] }, plan: {} }) as any;

function bark(fee: number | null = 20) {
  return {
    sendPayment: jest.fn().mockResolvedValue({ paymentHash: 'ab'.repeat(32), status: 'confirmed' }),
    getPaymentStatus: jest.fn().mockResolvedValue({ status: 'confirmed' }),
    backend: { estimatePaymentFee: jest.fn(async () => { if (fee === null) throw new Error('no estimate'); return { feeSats: fee }; }) },
  };
}

beforeEach(() => { mockExecute.mockClear(); mockQuoteOptions.mockReset(); });

test('a swap quote adds Bark fees for both provider invoices, and executes the provider quote', async () => {
  const inner = { recipientSat: 25000, totalSat: 26600, feeSat: 1600, expiresAt: now() + 60 };
  mockQuoteOptions.mockResolvedValue([{ id: 'p', name: 'Provider', quote: inner }, { id: 'off', name: 'Offline', unavailable: 'Provider did not respond' }]);
  const b = bark(20);
  const account = createBarkPayAccount(b, 'signet');
  const [live, offline] = await account.quoteOptions!(preview(amountOffer), swapRoute);
  expect(live.quote).toMatchObject({ recipientSat: 25000, totalSat: 26640, feeSat: 1640 });
  expect(offline.unavailable).toBe('Provider did not respond');
  await account.execute!(preview(amountOffer), swapRoute, live.quote!, 'ui-1');
  expect(mockExecute).toHaveBeenCalledWith(expect.anything(), swapRoute, inner, 'ui-1');
});

test('no Bark fee estimate means no quote, never a partial total', async () => {
  mockQuoteOptions.mockResolvedValue([{ id: 'p', name: 'Provider', quote: { recipientSat: 500, totalSat: 504, feeSat: 4, expiresAt: now() + 60 } }]);
  const b = bark(null);
  const account = createBarkPayAccount(b, 'mainnet');
  const [option] = await account.quoteOptions!(preview(amountOffer), swapRoute);
  expect(option.quote).toBeUndefined();
  expect(option.unavailable).toContain('fee estimate');
  await expect(account.quote(preview(amountOffer), directRoute)).rejects.toThrow('fee estimate');
  expect(b.sendPayment).not.toHaveBeenCalled();
});

test('pays a BOLT12 offer directly, leaving a fixed amount to the offer', async () => {
  const b = bark(20);
  const account = createBarkPayAccount(b, 'signet');
  const quote = await account.quote(preview(amountOffer), directRoute);
  expect(quote).toMatchObject({ recipientSat: 5000, feeSat: 20, totalSat: 5020 });
  await expect(account.execute!(preview(amountOffer), directRoute, quote, 'ui-2')).resolves.toEqual({ status: 'completed', reference: 'ab'.repeat(32) });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice: amountOffer, amount: undefined });
  await expect(account.status!('ui-2')).resolves.toEqual({ status: 'completed', reference: 'ab'.repeat(32) });
  await expect(account.execute!(preview(amountOffer), directRoute, quote, 'ui-3')).rejects.toThrow('fresh quote'); // a quote pays once
});

test('passes the amount for an amountless offer and follows a pending payment', async () => {
  const b = bark(15);
  b.sendPayment.mockResolvedValueOnce({ paymentHash: 'cd'.repeat(32), status: 'pending' });
  const account = createBarkPayAccount(b, 'signet');
  const quote = await account.quote(preview(openOffer, 1200), directRoute);
  await expect(account.execute!(preview(openOffer, 1200), directRoute, quote, 'ui-4')).resolves.toMatchObject({ status: 'pending' });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice: openOffer, amount: 1200 });
  await expect(account.status!('ui-4')).resolves.toEqual({ status: 'completed', reference: 'cd'.repeat(32) });
  expect(b.getPaymentStatus).toHaveBeenCalledWith('cd'.repeat(32));
});

test('swap attempts keep their status recovery', async () => {
  const account = createBarkPayAccount(bark(), 'signet');
  await expect(account.status!('existing-attempt')).resolves.toEqual({ status: 'pending' });
  expect(mockStatus).toHaveBeenCalledWith('existing-attempt');
});

const SERVER = 'ab'.repeat(32);
const RAIL = `bark:${SERVER}`;
const arkRoute = { kind: 'direct', sourceId: 'bark-ark', from: RAIL, to: RAIL } as any;
const arkPreview = (addresses: Record<string, string> = { [RAIL]: 'ark1receiver' }) =>
  ({ code: { offer: openOffer }, request: { id: 'r', network: 'mainnet', amountSat: 2100, acceptedRails: [RAIL, 'ln'] }, plan: {}, addresses }) as any;

test('barkRail takes a compressed or x-only server key', () => {
  expect(barkRail('02' + SERVER)).toBe(RAIL);
  expect(barkRail(SERVER.toUpperCase())).toBe(RAIL);
  expect(barkRail('04' + SERVER)).toBeNull();
});

test("pays the receiver's Bark address directly, with Bark's Ark fee in the quote", async () => {
  const b = bark(3);
  b.sendPayment.mockResolvedValueOnce({ paymentHash: '', status: 'pending' });
  const account = createBarkArkAccount(b, 'mainnet', RAIL);
  const [option] = await account.quoteOptions!(arkPreview(), arkRoute);
  expect(option.quote).toMatchObject({ recipientSat: 2100, feeSat: 3, totalSat: 2103 });
  expect(b.backend.estimatePaymentFee).toHaveBeenCalledWith('ark', 2100);
  await expect(account.execute!(arkPreview(), arkRoute, option.quote!, 'ark-1')).resolves.toEqual({ status: 'completed' });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice: 'ark1receiver', amount: 2100 });
  await expect(account.status!('ark-1')).resolves.toEqual({ status: 'completed' });
  await expect(account.execute!(arkPreview(), arkRoute, option.quote!, 'ark-2')).rejects.toThrow('fresh quote');
});

test('no address on this server, a foreign address or no fee estimate means no Bark address quote', async () => {
  const account = createBarkArkAccount(bark(3), 'mainnet', RAIL);
  await expect(account.quote(arkPreview({}), arkRoute)).rejects.toThrow('no Bark address');
  const foreign = { ...bark(3), backend: { ...bark(3).backend, isBarkAddress: () => false } };
  await expect(createBarkArkAccount(foreign, 'mainnet', RAIL).quote(arkPreview(), arkRoute)).rejects.toThrow('cannot pay');
  const [option] = await createBarkArkAccount(bark(null), 'mainnet', RAIL).quoteOptions!(arkPreview(), arkRoute);
  expect(option.unavailable).toContain('fee estimate');
});

test('connecting Bark registers the Ark route once the server key is known', async () => {
  const { previewPayment } = require('./index');
  const offer = require('@universal-bolt12/universal-code').withAcceptedRails(openOffer, [{ rail: RAIL, address: 'ark1receiver' }]);
  expect(offerRails(offer)[0]).toEqual({ rail: RAIL, address: 'ark1receiver' });
  const b = { ...bark(3), getConnectionInfo: jest.fn().mockResolvedValue({ connected: true, nodeId: '03' + SERVER }) };
  connectBarkToKaleidoPay(b, 'mainnet');
  await new Promise(r => setImmediate(r));
  const preview = previewPayment(offer, 'mainnet', '2100', 'req');
  expect(preview.addresses).toEqual({ [RAIL]: 'ark1receiver' });
  expect(preview.request.acceptedRails).toEqual([RAIL, 'ln']);
  expect(preview.plan.route).toMatchObject({ kind: 'direct', sourceId: 'bark-ark', to: RAIL });
  expect(preview.plan.alternatives).toEqual([expect.objectContaining({ kind: 'direct', sourceId: 'bark', to: 'ln:mainnet' })]);
  disconnectBarkFromKaleidoPay();
  expect(previewPayment(offer, 'mainnet', '2100', 'req').plan.status).toBe('unsupported');
});

test('Bark sends on-chain itself, next to the swap providers, with its own fee quoted', async () => {
  const b = bark(150);
  b.sendPayment.mockResolvedValueOnce({ paymentHash: 'ef'.repeat(32), status: 'pending' });
  const account = createBarkOnchainAccount(b, 'mainnet');
  const route = { kind: 'direct', sourceId: 'bark-onchain', from: 'btc:mainnet', to: 'btc:mainnet' } as any;
  const p = { code: { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }, request: { id: 'r', network: 'mainnet', amountSat: 30000, acceptedRails: ['btc:mainnet'] }, plan: {}, addresses: {} } as any;
  const [option] = await account.quoteOptions!(p, route);
  expect(option.quote).toMatchObject({ recipientSat: 30000, feeSat: 150, totalSat: 30150 });
  expect(b.backend.estimatePaymentFee).toHaveBeenCalledWith('onchain', 30000, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  await expect(account.execute!(p, route, option.quote!, 'oc-1')).resolves.toEqual({ status: 'completed', reference: 'ef'.repeat(32) });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', amount: 30000 });
  await expect(account.status!('oc-1')).resolves.toEqual({ status: 'completed', reference: 'ef'.repeat(32) });
  await expect(account.quote({ ...p, code: {} }, route)).rejects.toThrow('no bitcoin address');
});
