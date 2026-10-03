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
import { barkRail, connectBarkToKaleidoPay, createBarkArkAccount, createBarkArkAddressAccount, createBarkOnchainAccount, createBarkPayAccount, disconnectBarkFromKaleidoPay } from './bark';
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
  mockQuoteOptions.mockResolvedValue([{ id: 'p', name: 'Provider', detail: 'abc…def', quote: inner }, { id: 'off', name: 'Offline', unavailable: 'Provider did not respond' }]);
  const b = bark(20);
  const account = createBarkPayAccount(b, 'signet');
  const [live, offline] = await account.quoteOptions!(preview(amountOffer), swapRoute);
  expect(live.quote).toMatchObject({ recipientSat: 25000, totalSat: 26640, feeSat: 1640 });
  expect(live.detail).toBe('abc…def');
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

test('a fixed-amount offer quoted for another amount is refused before anything is sent', async () => {
  const b = bark(20);
  const account = createBarkPayAccount(b, 'signet');
  await expect(account.quote(preview(amountOffer, 1000), directRoute)).rejects.toThrow('different amount');
  const [option] = await account.quoteOptions!(preview(amountOffer, 1000), directRoute);
  expect(option.quote).toBeUndefined();
  expect(b.sendPayment).not.toHaveBeenCalled();
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

test('an offer payment Bark left in flight without a hash needs checking instead of staying pending', async () => {
  const b = bark(15);
  b.sendPayment.mockResolvedValueOnce({ paymentHash: '', status: 'pending' });
  const account = createBarkPayAccount(b, 'signet');
  const quote = await account.quote(preview(openOffer, 1200), directRoute);
  await expect(account.execute!(preview(openOffer, 1200), directRoute, quote, 'ui-nohash')).resolves.toMatchObject({ status: 'pending' });
  await expect(account.status!('ui-nohash')).resolves.toEqual({ status: 'unknown' });
});

test('a stale direct quote is refused as not sent', async () => {
  const { PaymentNotSentError } = require('./errors');
  const account = createBarkPayAccount(bark(15), 'signet');
  const quote = await account.quote(preview(openOffer, 1200), directRoute);
  await expect(account.execute!(preview(openOffer, 1200), directRoute, { ...quote }, 'ui-stale')).rejects.toBeInstanceOf(PaymentNotSentError);
});

test('a pending offer payment is re-checked only after Bark syncs', async () => {
  const b: any = bark(15);
  const order: string[] = [];
  b.backend.sync = jest.fn(async () => { order.push('sync'); });
  b.getPaymentStatus.mockImplementation(async () => { order.push('status'); return { status: 'confirmed' }; });
  b.sendPayment.mockResolvedValueOnce({ paymentHash: 'ef'.repeat(32), status: 'pending' });
  const account = createBarkPayAccount(b, 'signet');
  const quote = await account.quote(preview(openOffer, 1200), directRoute);
  await account.execute!(preview(openOffer, 1200), directRoute, quote, 'ui-sync');
  await expect(account.status!('ui-sync')).resolves.toMatchObject({ status: 'completed' });
  expect(order).toEqual(['sync', 'status']);
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
  b.sendPayment.mockResolvedValueOnce({ paymentHash: '', status: 'pending', amount: 2100 }); // the adapter's shape once cosigned
  const account = createBarkArkAccount(b, 'mainnet', RAIL);
  const [option] = await account.quoteOptions!(arkPreview(), arkRoute);
  expect(option.quote).toMatchObject({ recipientSat: 2100, feeSat: 3, totalSat: 2103 });
  expect(b.backend.estimatePaymentFee).toHaveBeenCalledWith('ark', 2100);
  await expect(account.execute!(arkPreview(), arkRoute, option.quote!, 'ark-1')).resolves.toEqual({ status: 'completed' });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice: 'ark1receiver', amount: 2100 });
  await expect(account.status!('ark-1')).resolves.toEqual({ status: 'completed' });
  await expect(account.execute!(arkPreview(), arkRoute, option.quote!, 'ark-2')).rejects.toThrow('fresh quote');
});

test('an Ark send that failed or moved another amount is not shown as paid', async () => {
  const b = bark(3);
  const account = createBarkArkAccount(b, 'mainnet', RAIL);
  b.sendPayment.mockResolvedValueOnce({ paymentHash: '', status: 'failed', amount: 2100 });
  await expect(account.execute!(arkPreview(), arkRoute, (await account.quote(arkPreview(), arkRoute)), 'ark-f')).resolves.toEqual({ status: 'failed' });
  b.sendPayment.mockResolvedValueOnce({ paymentHash: '', status: 'pending', amount: 999 });
  await expect(account.execute!(arkPreview(), arkRoute, (await account.quote(arkPreview(), arkRoute)), 'ark-u')).resolves.toEqual({ status: 'unknown' });
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
  jest.useFakeTimers();
  const b = { ...bark(3), getConnectionInfo: jest.fn().mockResolvedValueOnce({ connected: true }).mockResolvedValue({ connected: true, nodeId: '03' + SERVER }) };
  connectBarkToKaleidoPay(b, 'mainnet');
  await jest.advanceTimersByTimeAsync(2500); // the first read has no server key yet
  jest.useRealTimers();
  expect(b.getConnectionInfo).toHaveBeenCalledTimes(2);
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

test('reviewing a payment syncs Bark and adds the Ark route when the key arrived late', async () => {
  const { previewPayment, prepareKaleidoPay } = require('./index');
  const offer = require('@universal-bolt12/universal-code').withAcceptedRails(openOffer, [{ rail: RAIL, address: 'ark1receiver' }]);
  jest.useFakeTimers();
  let synced = false;
  const b = { ...bark(3), backend: { ...bark(3).backend, sync: jest.fn(async () => { synced = true; }) },
    getConnectionInfo: jest.fn(async () => synced ? { connected: true, nodeId: SERVER } : { connected: true }) };
  connectBarkToKaleidoPay(b, 'mainnet');
  await jest.advanceTimersByTimeAsync(0);
  expect(previewPayment(offer, 'mainnet', '2100', 'req').plan.route.sourceId).toBe('bark');
  jest.useRealTimers();
  await prepareKaleidoPay();
  expect(b.backend.sync).toHaveBeenCalled();
  expect(previewPayment(offer, 'mainnet', '2100', 'req').plan.route).toMatchObject({ sourceId: 'bark-ark', to: RAIL });
  disconnectBarkFromKaleidoPay();
});

// ---------------------------------------------------------------------------
// BOLT11 invoices, plain Ark addresses and the balance check.
// ---------------------------------------------------------------------------
import { bech32 } from '@scure/base';

/** A well-formed (unsigned) BOLT11 invoice: enough for the decoder Bark's quote uses. */
function bolt11({ amount, timestamp = now(), expiry, hash = '11'.repeat(32) }: { amount?: string; timestamp?: number; expiry?: number; hash?: string }): string {
  const toWords = (n: number, len: number) => Array.from({ length: len }, (_, i) => (n >> (5 * (len - 1 - i))) & 31);
  const tag = (type: number, data: number[]) => [type, ...toWords(data.length, 2), ...data];
  const words = [
    ...toWords(timestamp, 7),
    ...tag(1, bech32.toWords(Uint8Array.from(hash.match(/../g)!.map(h => parseInt(h, 16))))),
    ...(expiry !== undefined ? tag(6, toWords(expiry, 2)) : []),
    ...new Array(104).fill(0),
  ];
  return bech32.encode(`lntb${amount ?? ''}`, words, 2000);
}
const invoicePreview = (invoice: string, amountSat: number) =>
  ({ code: { kind: 'bolt11', invoice }, request: { id: 'r', network: 'signet', networks: ['signet'], amountSat, acceptedRails: ['ln'] }, plan: {}, addresses: {} }) as any;

test('pays a fixed-amount BOLT11 invoice directly without passing an amount', async () => {
  const b = bark(7);
  b.sendPayment.mockResolvedValueOnce({ paymentHash: '', status: 'pending' });
  const invoice = bolt11({ amount: '50u', hash: '22'.repeat(32) }); // 5,000 sat
  const account = createBarkPayAccount(b, 'signet');
  const [option] = await account.quoteOptions!(invoicePreview(invoice, 5000), directRoute);
  expect(option).toMatchObject({ id: 'bark-invoice', quote: { recipientSat: 5000, feeSat: 7, totalSat: 5007 } });
  expect(b.backend.estimatePaymentFee).toHaveBeenCalledWith('lightning', 5000);
  await expect(account.execute!(invoicePreview(invoice, 5000), directRoute, option.quote!, 'inv-1')).resolves.toMatchObject({ status: 'pending' });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice, amount: undefined });
  // Bark gave no hash, so the payment is followed by the invoice's own payment hash.
  await expect(account.status!('inv-1')).resolves.toEqual({ status: 'completed', reference: '22'.repeat(32) });
  expect(b.getPaymentStatus).toHaveBeenCalledWith('22'.repeat(32));
  await expect(account.quote(invoicePreview(invoice, 4000), directRoute)).rejects.toThrow('different amount');
});

test('pays an amountless BOLT11 invoice the requested amount', async () => {
  const b = bark(4);
  const invoice = bolt11({});
  const account = createBarkPayAccount(b, 'signet');
  const quote = await account.quote(invoicePreview(invoice, 1234), directRoute);
  expect(quote).toMatchObject({ recipientSat: 1234, totalSat: 1238 });
  await expect(account.execute!(invoicePreview(invoice, 1234), directRoute, quote, 'inv-2')).resolves.toEqual({ status: 'completed', reference: 'ab'.repeat(32) });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice, amount: 1234 });
});

test('an expired invoice is refused before anything is sent', async () => {
  const { PaymentNotSentError } = require('./errors');
  const b = bark(4);
  const account = createBarkPayAccount(b, 'signet');
  const expired = bolt11({ timestamp: now() - 7200 }); // default one-hour expiry
  await expect(account.quote(invoicePreview(expired, 1000), directRoute)).rejects.toThrow('expired');
  const [option] = await account.quoteOptions!(invoicePreview(expired, 1000), directRoute);
  expect(option.unavailable).toContain('expired');
  // A quote never outlives its invoice, and an invoice that lapses after quoting is not paid.
  const soon = bolt11({ expiry: 2 });
  const quote = await account.quote(invoicePreview(soon, 1000), directRoute);
  expect(quote.expiresAt).toBeLessThanOrEqual(now() + 2);
  jest.useFakeTimers({ now: Date.now() + 5000 });
  await expect(account.execute!(invoicePreview(soon, 1000), directRoute, quote, 'inv-x')).rejects.toBeInstanceOf(PaymentNotSentError);
  jest.useRealTimers();
  expect(b.sendPayment).not.toHaveBeenCalled();
});

const plainArkRoute = { kind: 'direct', sourceId: 'bark-ark-address', from: 'ark:signet', to: 'ark:signet' } as any;
const plainArkPreview = (arkAddress = 'tark1receiver') =>
  ({ code: { kind: 'ark', arkAddress }, request: { id: 'r', network: 'signet', networks: ['signet'], amountSat: 3000, acceptedRails: ['ark'] }, plan: {}, addresses: { ark: arkAddress } }) as any;

test('pays a plain Ark address that is on Bark’s server', async () => {
  const b: any = bark(2);
  b.backend.isBarkAddress = jest.fn(() => true);
  b.sendPayment.mockResolvedValueOnce({ paymentHash: '', status: 'pending', amount: 3000 });
  const account = createBarkArkAddressAccount(b, 'signet');
  expect(account.source).toMatchObject({ rail: 'ark', network: 'signet' });
  const [option] = await account.quoteOptions!(plainArkPreview(), plainArkRoute);
  expect(option.quote).toMatchObject({ recipientSat: 3000, feeSat: 2, totalSat: 3002 });
  expect(b.backend.isBarkAddress).toHaveBeenCalledWith('tark1receiver');
  await expect(account.execute!(plainArkPreview(), plainArkRoute, option.quote!, 'pa-1')).resolves.toEqual({ status: 'completed' });
  expect(b.sendPayment).toHaveBeenCalledWith({ invoice: 'tark1receiver', amount: 3000 });
  await expect(account.status!('pa-1')).resolves.toEqual({ status: 'completed' });
  await expect(account.execute!(plainArkPreview(), plainArkRoute, option.quote!, 'pa-2')).rejects.toThrow('fresh quote');
});

test('a plain Ark address Bark does not recognise as its own is unavailable', async () => {
  const b: any = bark(2);
  b.backend.isBarkAddress = () => false;
  const account = createBarkArkAddressAccount(b, 'signet');
  await expect(account.quote(plainArkPreview(), plainArkRoute)).rejects.toThrow("not on Bark's server");
  const [option] = await account.quoteOptions!(plainArkPreview(), plainArkRoute);
  expect(option.unavailable).toBe("This Ark address is not on Bark's server.");
  await expect(createBarkArkAddressAccount(bark(2), 'signet').quote(plainArkPreview(), plainArkRoute)).rejects.toThrow("not on Bark's server");
  expect(b.sendPayment).not.toHaveBeenCalled();
});

test('connecting Bark plans a plain Ark address to the Bark Ark account', () => {
  const { previewTarget } = require('./index');
  const b: any = { ...bark(2), backend: { ...bark(2).backend, isBarkAddress: () => true } };
  jest.useFakeTimers(); // the Ark server-key retries must not outlive the test
  connectBarkToKaleidoPay(b, 'signet');
  const p = previewTarget({ kind: 'ark', raw: 'tark1receiver', arkAddress: 'tark1receiver', networks: ['signet'] }, 3000, 'req');
  expect(p.plan.route).toMatchObject({ kind: 'direct', sourceId: 'bark-ark-address', to: 'ark:signet' });
  disconnectBarkFromKaleidoPay();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('quotes above Bark’s spendable balance are refused', async () => {
  const withBalance = (confirmed: number) => ({ ...bark(10), getBtcBalance: jest.fn(async () => ({ confirmed })) });
  const lightning = createBarkPayAccount(withBalance(1009), 'signet');
  await expect(lightning.quote(invoicePreview(bolt11({}), 1000), directRoute)).rejects.toThrow('Not enough in Bark');
  await expect(createBarkPayAccount(withBalance(1010), 'signet').quote(invoicePreview(bolt11({}), 1000), directRoute)).resolves.toMatchObject({ totalSat: 1010 });
  const ark: any = withBalance(100);
  ark.backend.isBarkAddress = () => true;
  const [arkOption] = await createBarkArkAddressAccount(ark, 'signet').quoteOptions!(plainArkPreview(), plainArkRoute);
  expect(arkOption.unavailable).toContain('Not enough in Bark');
  const onchainRoute = { kind: 'direct', sourceId: 'bark-onchain', from: 'btc:mainnet', to: 'btc:mainnet' } as any;
  const p = { code: { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }, request: { id: 'r', network: 'mainnet', networks: ['mainnet'], amountSat: 30000, acceptedRails: ['btc'] }, plan: {}, addresses: {} } as any;
  await expect(createBarkOnchainAccount(withBalance(100), 'mainnet').quote(p, onchainRoute)).rejects.toThrow('Not enough in Bark');
  mockQuoteOptions.mockResolvedValue([{ id: 'p', name: 'Provider', quote: { recipientSat: 500, totalSat: 504, feeSat: 4, expiresAt: now() + 60 } }]);
  const [swapOption] = await createBarkPayAccount(withBalance(100), 'signet').quoteOptions!(preview(amountOffer), swapRoute);
  expect(swapOption.unavailable).toContain('Not enough in Bark');
});

test('on-chain sends plan from the network-free btc rail', () => {
  const { planRoutes } = require('./index');
  const account = createBarkOnchainAccount(bark(1), 'mainnet');
  const plan = planRoutes({ id: 'r', network: 'mainnet', networks: ['mainnet'], amountSat: 1000, acceptedRails: ['btc'] }, [account.source]);
  expect(plan.route).toMatchObject({ kind: 'direct', sourceId: 'bark-onchain', from: 'btc:mainnet', to: 'btc:mainnet' });
});
