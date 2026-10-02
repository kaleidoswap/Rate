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
import { createBarkPayAccount } from './bark';

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
