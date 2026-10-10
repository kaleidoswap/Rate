import {
  swapReadback,
  paymentReadback,
  requiresStrongAuth,
  secondsLeft,
  priceChangeWarning,
  buildConfirmReadback,
} from './aiConfirm';
import { makeInvoice } from './agentWallet/__fixtures__/invoice';
import { authorizeSpend } from './spendAuth';
import { describeSwapQuote } from './swapTools';
import { previewSendPayment } from './walletTools';

jest.mock('./swapTools', () => ({ describeSwapQuote: jest.fn() }));
jest.mock('./walletTools', () => ({
  previewSendPayment: jest.fn(),
  reconcileInvoiceAmount: (_invoice: string, requested?: number) => requested,
  lightningRailLabel: jest.fn(() => 'Lightning (Spark wallet)'),
}));
jest.mock('./SecurityService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));

const QUOTE = {
  quoteId: 'rfq1', venue: 'kaleidoswap' as const, from: 'BTC', to: 'USDT',
  sendAmount: 100_000, receiveAmount: 73.5, receiveUnit: 'USDT',
  fee: 1250, feeUnit: 'sats', fromLayer: 'BTC_LN', toLayer: 'RGB_LN', expiresAt: 1_000_000,
};

describe('swap readback', () => {
  it('shows what you send, receive, the fee, venue and expiry', () => {
    const r = swapReadback(QUOTE);
    expect(r.amount).toBe('100,000 sats');
    expect(r.amountSats).toBe(100_000);
    expect(r.rows).toEqual([
      { label: 'You send', value: '100,000 sats · Lightning' },
      { label: 'You receive', value: '73.5 USDT · RGB Lightning' },
      { label: 'Fee', value: '1,250 sats' },
      { label: 'Venue', value: 'KaleidoSwap' },
    ]);
    expect(r.expiresAt).toBe(1_000_000);
    expect(r.shownReceive).toBe(73.5);
    expect(r.spoken).toBe('Swap 100,000 sats for 73.5 USDT on KaleidoSwap. Tap to approve.');
  });

  it('names Flashnet and an asset-side send without a sats value', () => {
    const r = swapReadback({ ...QUOTE, venue: 'flashnet', from: 'USDB', to: 'BTC', sendAmount: 20, receiveAmount: 25_000, receiveUnit: 'sats', fee: undefined, feeUnit: undefined, fromLayer: 'Spark', toLayer: 'Spark' });
    expect(r.amountSats).toBeUndefined();
    expect(r.rows.find((x) => x.label === 'Venue')?.value).toBe('Flashnet');
    expect(r.rows.find((x) => x.label === 'Fee')?.value).toBe('Included in the price');
    expect(r.rows[0].value).toBe('20 USDB · Spark');
  });

  it('shows the floor a Flashnet swap can end at, and nothing for a fixed-terms maker swap', () => {
    const flash = swapReadback({ ...QUOTE, venue: 'flashnet', receiveAmount: 25_000, receiveUnit: 'sats', minReceive: 24_750 });
    expect(flash.rows.find((x) => x.label === 'At least')?.value).toBe('24,750 sats');
    expect(swapReadback(QUOTE).rows.find((x) => x.label === 'At least')).toBeUndefined();
  });

  it('execute_swap builds from the cached quote and refuses a missing one', async () => {
    (describeSwapQuote as jest.Mock).mockReturnValueOnce(QUOTE).mockReturnValueOnce(null);
    await expect(buildConfirmReadback({ name: 'execute_swap', arguments: { quote_id: 'rfq1' } })).resolves.toMatchObject({ kind: 'swap', quoteId: 'rfq1' });
    await expect(buildConfirmReadback({ name: 'execute_swap', arguments: { quote_id: 'gone' } })).rejects.toThrow(/no longer available/);
  });
});

describe('payment readback', () => {
  it('shows the matched contact and the full destination', async () => {
    (previewSendPayment as jest.Mock).mockResolvedValueOnce({ recipientName: 'Walter', destination: 'walter@ln.tips', kind: 'lightning_address' });
    const r = await buildConfirmReadback({ name: 'send_payment', arguments: { to: 'walter', amount_sats: 2_100 } });
    expect(r.amount).toBe('2,100 sats');
    expect(r.recipientName).toBe('Walter');
    expect(r.rows).toEqual(expect.arrayContaining([
      { label: 'Contact', value: 'Walter' },
      { label: 'Lightning address', value: 'walter@ln.tips', copyable: true },
      { label: 'Network', value: 'Lightning (Spark wallet)' },
    ]));
    expect(r.spoken).toBe('Send 2,100 sats to Walter. Tap to approve.');
  });

  it('declines an unknown contact instead of opening the sheet', async () => {
    (previewSendPayment as jest.Mock).mockRejectedValueOnce(new Error('No contact named "Al".'));
    await expect(buildConfirmReadback({ name: 'send_payment', arguments: { to: 'Al', amount_sats: 5 } })).rejects.toThrow('No contact named "Al"');
  });

  it('keeps an invoice without an amount explicit', () => {
    const r = paymentReadback({ preview: { destination: 'not-an-invoice', kind: 'other' }, network: 'Lightning' });
    expect(r.amount).toBeUndefined();
    expect(r.amountSats).toBeUndefined();
  });
});

describe('strong auth threshold', () => {
  it('gates at or above the threshold', () => {
    expect(requiresStrongAuth({ kind: 'payment', amountSats: 49_999 }, 50_000)).toBe(false);
    expect(requiresStrongAuth({ kind: 'payment', amountSats: 50_000 }, 50_000)).toBe(true);
  });
  it('always gates spends of unknown BTC value and a zero threshold', () => {
    expect(requiresStrongAuth({ kind: 'asset' }, 50_000)).toBe(true);
    expect(requiresStrongAuth({ kind: 'payment', amountSats: 1 }, 0)).toBe(true);
  });
});

describe('authorizeSpend', () => {
  const sec = (over: Partial<Record<string, jest.Mock>> = {}) => ({
    getSecuritySettings: jest.fn(async () => ({ pinEnabled: false, biometricEnabled: false })),
    authenticateWithBiometric: jest.fn(async () => true),
    isDeviceAuthAvailable: jest.fn(async () => false),
    authenticateForReveal: jest.fn(async () => true),
    ...over,
  }) as any;

  it('uses biometrics without the device passcode when a wallet PIN exists', async () => {
    const s = sec({ getSecuritySettings: jest.fn(async () => ({ pinEnabled: true, biometricEnabled: true })) });
    await expect(authorizeSpend('Confirm', s)).resolves.toBe('approved');
    expect(s.authenticateWithBiometric).toHaveBeenCalledWith('Confirm', { allowDeviceFallback: false });
  });
  it('falls back to the wallet PIN when biometrics fail', async () => {
    const s = sec({
      getSecuritySettings: jest.fn(async () => ({ pinEnabled: true, biometricEnabled: true })),
      authenticateWithBiometric: jest.fn(async () => false),
    });
    await expect(authorizeSpend('Confirm', s)).resolves.toBe('pin');
  });
  it('uses the device lock when the wallet has none, and denies on failure', async () => {
    const s = sec({ isDeviceAuthAvailable: jest.fn(async () => true), authenticateForReveal: jest.fn(async () => false) });
    await expect(authorizeSpend('Confirm', s)).resolves.toBe('denied');
  });
});

describe('expiry + price warning', () => {
  it('counts down whole seconds and stops at zero', () => {
    expect(secondsLeft(10_500, 0)).toBe(11);
    expect(secondsLeft(10_000, 20_000)).toBe(0);
    expect(secondsLeft(undefined)).toBeUndefined();
  });
  it('words a move against the user plainly', () => {
    expect(priceChangeWarning(0.016)).toBe('The price moved 1.6% against you since the quote. Check the new amounts and approve again.');
  });
});

describe('agent wallet payment readback', () => {
  const invoice = makeInvoice({ sats: 500, paymentHash: 'ab'.repeat(32), timestamp: 1_790_000_000, expiry: 600 });

  it('shows the amount from the invoice, the service and that it pays from the Agent wallet', async () => {
    const r = await buildConfirmReadback({ name: 'fetch_paid_resource', arguments: { agent_wallet: true, service: 'api.example.com', amount_sats: 500, fee_sats: 3, invoice, why: 'Above the limit.' } });
    expect(r).toMatchObject({ kind: 'payment', title: 'Agent wallet payment', amount: '500 sats', amountSats: 500, recipientName: 'api.example.com' });
    expect(r.rows).toEqual(expect.arrayContaining([{ label: 'Pays from', value: 'Agent wallet' }, { label: 'Fee', value: 'Up to 3 sats' }]));
  });

  it('shows what the daily and monthly limits leave', async () => {
    const r = await buildConfirmReadback({ name: 'fetch_paid_resource', arguments: { agent_wallet: true, service: 'api.example.com', amount_sats: 500, fee_sats: 3, invoice, left_today_sats: 4_500, left_month_sats: 49_500 } });
    expect(r.rows).toEqual(expect.arrayContaining([{ label: 'Budget left', value: '4,500 sats today · 49,500 sats this month' }]));
  });

  it('refuses when the amount shown would not match the invoice', async () => {
    await expect(buildConfirmReadback({ name: 'fetch_paid_resource', arguments: { agent_wallet: true, service: 'a.com', amount_sats: 5, invoice } })).rejects.toThrow(/doesn't match/);
  });
});
