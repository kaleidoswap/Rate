jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
const now = () => Math.floor(Date.now() / 1000);
const mockOffers = [{ pubkey: 'cheap' }, { pubkey: 'silent' }, { pubkey: 'pricey' }];
const mockQuotes = (expires = now() + 60) => [
  { provider: 'silent', payerSat: 26500, expiresAt: expires },
  { provider: 'cheap', payerSat: 26600, expiresAt: expires },
  { provider: 'pricey', payerSat: 27500, expiresAt: expires },
];
const mockStartAttempt = jest.fn(async ({ quote }: any) => {
  if (quote.provider === 'silent') throw new Error('swap server did not answer createswap');
  return { id: `a-${quote.provider}`, stage: 'created', quote };
});
const mockPayAttempt = jest.fn(async (a: any) => ({ ...a, stage: 'claimed' }));
jest.mock('@universal-bolt12/swap-market', () => ({
  discoverOffers: jest.fn(async () => mockOffers),
  rankedReverseQuotes: jest.fn(() => mockQuotes()),
  startAttempt: (...args: any[]) => (mockStartAttempt as any)(...args),
  payAttempt: (...args: any[]) => (mockPayAttempt as any)(...args),
  resumeAttempt: jest.fn(),
  Esplora: class { async feeRate() { return 3; } },
  ESPLORA: { mainnet: 'x', signet: 'x' },
}));

import { encodePaymentCode } from '@universal-bolt12/universal-code';
import { createElectrumSwapAccount } from './electrumSwapAccount';
import { previewPayment, quotePayment, quotePaymentOffers, executePaymentOffer, executePayment, registerKaleidoPayAccount, PaymentNotSentError } from './index';

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const store = { save: jest.fn(), load: jest.fn(), list: jest.fn(async () => []) };
const secrets = { put: jest.fn(), get: jest.fn() };
const payer = { payInvoices: jest.fn() };

beforeEach(() => mockStartAttempt.mockClear());

test('quotes from published offers without opening swaps; a silent provider at pay time sends nothing', async () => {
  const account = createElectrumSwapAccount({ source: { id: 'bark', rail: 'ln', network: 'mainnet' }, payer, attempts: store, secrets });
  const off = registerKaleidoPayAccount(account);
  try {
    const preview = previewPayment(encodePaymentCode({ address, amountSat: 25000 }, 'mainnet'), 'mainnet', '', 'r1');
    expect(preview.plan.status).toBe('ready');
    if (preview.plan.status === 'ready') expect(preview.plan.route).toMatchObject({ kind: 'swap', to: 'btc:mainnet', providerId: 'electrum-nostr' });
    const silent = await quotePayment(preview);
    expect(silent).toMatchObject({ recipientSat: 25000, totalSat: 26500, feeSat: 1500 });
    expect(mockStartAttempt).not.toHaveBeenCalled(); // reviewing never opens a swap or stores its secrets
    expect(secrets.put).not.toHaveBeenCalled();
    await expect(executePayment(preview, silent)).rejects.toBeInstanceOf(PaymentNotSentError);
    expect(mockPayAttempt).not.toHaveBeenCalled();
    const offers = await quotePaymentOffers(preview);
    const cheap = offers.find(o => o.id.endsWith(':cheap'))!;
    await executePaymentOffer(preview, cheap, 'pay-cheap');
    expect(mockStartAttempt).toHaveBeenLastCalledWith(expect.objectContaining({ destination: address, timeoutMs: 10000, requestId: 'bark:pay-cheap', quote: expect.objectContaining({ provider: 'cheap' }) }), expect.anything());
    expect(mockPayAttempt).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-cheap' }), payer, expect.anything());
  } finally { off(); }
});

test('refuses to pay a total the user did not approve', async () => {
  const account = createElectrumSwapAccount({ source: { id: 'bark2', rail: 'ln', network: 'mainnet' }, payer, attempts: store, secrets });
  const off = registerKaleidoPayAccount(account);
  try {
    const preview = previewPayment(encodePaymentCode({ address, amountSat: 25000 }, 'mainnet'), 'mainnet', '', 'r2');
    await quotePayment(preview);
    mockPayAttempt.mockClear();
    await expect(executePayment(preview, { recipientSat: 25000, totalSat: 26000, feeSat: 1000, expiresAt: now() + 60 })).rejects.toThrow('approved total');
    expect(mockPayAttempt).not.toHaveBeenCalled();
  } finally { off(); }
});

beforeEach(() => mockPayAttempt.mockClear());

test('execute starts paying and status follows the swap to completion', async () => {
  let finish: (a: any) => void = () => {};
  mockPayAttempt.mockImplementationOnce((a: any, _p: any, deps: any) => {
    deps.onUpdate({ ...a, stage: 'waiting_lockup' });
    return new Promise(res => { finish = res; });
  });
  mockStartAttempt.mockImplementationOnce(async ({ quote }: any) => ({ id: 'a-silent-ok', stage: 'created', quote }));
  const account = createElectrumSwapAccount({ source: { id: 'bark3', rail: 'ln', network: 'mainnet' }, payer, attempts: store, secrets });
  const off = registerKaleidoPayAccount(account);
  try {
    const preview = previewPayment(encodePaymentCode({ address, amountSat: 25000 }, 'mainnet'), 'mainnet', '', 'r3');
    const quote = await quotePayment(preview);
    if (preview.plan.status !== 'ready') throw new Error('plan');
    const started = await account.execute(preview, preview.plan.route, quote, 'ui-1');
    expect(started).toEqual({ status: 'pending', reference: 'a-silent-ok' });
    expect(await account.execute(preview, preview.plan.route, quote, 'ui-1')).toMatchObject({ status: 'pending' });
    expect(mockPayAttempt).toHaveBeenCalledTimes(1);
    store.load.mockResolvedValueOnce(null);
    expect(await account.status('ui-1')).toMatchObject({ status: 'pending' });
    finish({ id: 'a-silent-ok', stage: 'claimed', claim: { txid: 'c1' } });
    await new Promise(r => setTimeout(r, 0));
    expect(await account.status('ui-1')).toEqual({ status: 'completed', reference: 'c1' });
    expect(await account.status('nope')).toEqual({ status: 'unknown' });
  } finally { off(); }
});

test('exposes each provider and pays the explicitly selected offer even after refresh', async () => {
  const account = createElectrumSwapAccount({ source: { id: 'choices', rail: 'ln', network: 'mainnet' }, payer, attempts: store, secrets });
  const off = registerKaleidoPayAccount(account);
  try {
    const preview = previewPayment(encodePaymentCode({ address, amountSat: 25000 }, 'mainnet'), 'mainnet', '', 'choices');
    const offers = await quotePaymentOffers(preview);
    expect(offers).toHaveLength(3);
    expect(offers.every(o => o.quote && !o.unavailable)).toBe(true);
    const selected = offers.find(o => o.id.endsWith(':pricey'))!;
    expect(selected.quote?.totalSat).toBe(27500);
    await quotePaymentOffers(preview); // Refreshing must not overwrite the selected provider's attempt.
    await executePaymentOffer(preview, selected, 'selected-pricey');
    expect(mockPayAttempt).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-pricey' }), payer, expect.anything());
  } finally { off(); }
});

test('reconstructs status from the durable payment-attempt mapping after remount', async () => {
  const saved = { id: 'swap-saved', requestId: 'restore:ui-saved', stage: 'claimed', claim: { txid: 'confirmed' } };
  const persisted = { save: jest.fn(), load: jest.fn(async () => saved), list: jest.fn(async () => [saved]) } as any;
  const account = createElectrumSwapAccount({ source: { id: 'restore', rail: 'ln', network: 'mainnet' }, payer, attempts: persisted, secrets });
  expect(await account.status('ui-saved')).toEqual({ status: 'completed', reference: 'confirmed' });
  expect(mockPayAttempt).not.toHaveBeenCalled();
});
