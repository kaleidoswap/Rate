jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockInvoices: Record<string, { amountSats?: number; timestamp: number; expiry?: number }> = {};
jest.mock('../../utils/decodeInvoice', () => ({
  decodeBolt11: (invoice: string) => ({ amountSats: mockInvoices[invoice]?.amountSats }),
}));
jest.mock('light-bolt11-decoder', () => ({
  decode: (invoice: string) => {
    const i = mockInvoices[invoice];
    if (!i) throw new Error('bad invoice');
    return { sections: [{ name: 'timestamp', value: i.timestamp }, ...(i.expiry !== undefined ? [{ name: 'expiry', value: i.expiry }] : [])] };
  },
}));
import { connectSparkPayAccounts, createSparkLightningAccount, createSparkTransferAccount, fallbackLightningFee, invoiceTerms, resultOf } from './sparkPay';
import { executePaymentOffer, PaymentNotSentError, previewTarget, quotePaymentOffers } from './index';
import type { Preview, Route } from './index';

const now = () => Math.floor(Date.now() / 1000);
mockInvoices.fixed = { amountSats: 5000, timestamp: now(), expiry: 600 };
mockInvoices.open = { timestamp: now(), expiry: 600 };
mockInvoices.old = { amountSats: 5000, timestamp: now() - 7200 };

const lnRoute = { kind: 'direct', sourceId: 'spark-ln', from: 'ln:signet', to: 'ln:signet' } as Route;
const sparkRoute = { kind: 'direct', sourceId: 'spark-spark', from: 'spark:signet', to: 'spark:signet' } as Route;
const lnPreview = (invoice: string, amountSat = 5000) => ({ code: { kind: 'bolt11', raw: invoice, invoice }, request: { id: 'r', network: 'signet', networks: ['signet'], amountSat, acceptedRails: ['ln'] }, plan: {}, addresses: {} }) as unknown as Preview;
const sparkPreview = (sparkAddress = 'sparkt1abc', amountSat = 2000) => ({ code: { kind: 'spark', raw: sparkAddress, sparkAddress }, request: { id: 'r', network: 'signet', networks: ['signet'], amountSat, acceptedRails: ['spark'] }, plan: {}, addresses: {} }) as unknown as Preview;

function spark(opts: { fee?: number | null; balance?: number } = {}) {
  return {
    connected: true,
    isConnected: jest.fn(function (this: any) { return this.connected; }),
    getBtcBalance: jest.fn().mockResolvedValue({ confirmed: opts.balance ?? 100000 }),
    quotePaymentFee: jest.fn(async () => (opts.fee === undefined ? 7 : opts.fee)),
    sendPayment: jest.fn().mockResolvedValue({ paymentHash: 'ln-1', status: 'confirmed' }),
    getPaymentStatus: jest.fn().mockResolvedValue({ status: 'confirmed' }),
  };
}

test('invoiceTerms reads amount and expiry', () => {
  expect(invoiceTerms('fixed')).toEqual({ amountSat: 5000, expiresAtMs: (mockInvoices.fixed.timestamp + 600) * 1000 });
  expect(invoiceTerms('old').expiresAtMs).toBe((mockInvoices.old.timestamp + 3600) * 1000);
  expect(resultOf('settled', 'x')).toEqual({ status: 'completed', reference: 'x' });
  expect(resultOf('weird')).toEqual({ status: 'unknown' });
});

test('Lightning: quotes Spark fee, pays with the fee as cap and no amount for a fixed invoice', async () => {
  const s = spark();
  const account = createSparkLightningAccount(s, 'signet');
  const quote = await account.quote(lnPreview('fixed'), lnRoute);
  expect(quote).toMatchObject({ recipientSat: 5000, feeSat: 7, totalSat: 5007 });
  expect(s.quotePaymentFee).toHaveBeenCalledWith({ method: 'lightning', destination: 'fixed', amountSats: 5000, amountless: false });
  expect(s.sendPayment).not.toHaveBeenCalled();
  await expect(account.execute!(lnPreview('fixed'), lnRoute, quote, 'a1')).resolves.toEqual({ status: 'completed', reference: 'ln-1' });
  expect(s.sendPayment).toHaveBeenCalledWith({ invoice: 'fixed', maxFeeSats: 7 });
  await expect(account.status!('a1')).resolves.toEqual({ status: 'completed', reference: 'ln-1' });
  // A quote pays once.
  await expect(account.execute!(lnPreview('fixed'), lnRoute, quote, 'a2')).rejects.toBeInstanceOf(PaymentNotSentError);
});

test('Lightning: amountless invoice passes the amount; missing fee quote uses a marked maximum', async () => {
  const s = spark({ fee: null });
  const account = createSparkLightningAccount(s, 'signet');
  const [option] = await account.quoteOptions!(lnPreview('open', 3000), lnRoute);
  expect(option.quote).toMatchObject({ feeSat: fallbackLightningFee(3000), totalSat: 3000 + fallbackLightningFee(3000) });
  expect(option.detail).toContain('maximum');
  s.sendPayment.mockResolvedValueOnce({ paymentHash: 'ln-2', status: 'pending' });
  await expect(account.execute!(lnPreview('open', 3000), lnRoute, option.quote!, 'b1')).resolves.toEqual({ status: 'pending', reference: 'ln-2' });
  expect(s.sendPayment).toHaveBeenCalledWith({ invoice: 'open', amount: 3000, maxFeeSats: 30 });
  s.getPaymentStatus.mockResolvedValueOnce({ status: 'pending' });
  await expect(account.status!('b1')).resolves.toEqual({ status: 'pending', reference: 'ln-2' });
  await expect(account.status!('b1')).resolves.toEqual({ status: 'completed', reference: 'ln-2' });
  expect(s.getPaymentStatus).toHaveBeenCalledWith('ln-2');
});

test('Lightning: refuses balance shortfall, expired or mismatched invoices before sending', async () => {
  const s = spark({ balance: 5006 });
  const account = createSparkLightningAccount(s, 'signet');
  await expect(account.quote(lnPreview('fixed'), lnRoute)).rejects.toThrow('Not enough balance in Spark');
  const [option] = await account.quoteOptions!(lnPreview('fixed'), lnRoute);
  expect(option.unavailable).toBe('Not enough balance in Spark');
  await expect(account.quote(lnPreview('old'), lnRoute)).rejects.toThrow('expired');
  await expect(account.quote(lnPreview('fixed', 4000), lnRoute)).rejects.toThrow('different amount');
  expect(s.sendPayment).not.toHaveBeenCalled();
});

test('Lightning: a failed settlement is reported failed', async () => {
  const s = spark();
  s.sendPayment.mockRejectedValueOnce(Object.assign(new Error('failed'), { code: 'LIGHTNING_PAYMENT_FAILED' }));
  const account = createSparkLightningAccount(s, 'signet');
  const quote = await account.quote(lnPreview('fixed'), lnRoute);
  await expect(account.execute!(lnPreview('fixed'), lnRoute, quote, 'c1')).resolves.toEqual({ status: 'failed' });
});

test('Spark address: sends sats to the address and follows the transfer', async () => {
  const s = spark({ fee: 0 });
  s.sendPayment.mockResolvedValueOnce({ paymentHash: 'tx-1', status: 'pending' });
  const account = createSparkTransferAccount(s, 'signet');
  const quote = await account.quote(sparkPreview(), sparkRoute);
  expect(quote).toMatchObject({ recipientSat: 2000, feeSat: 0, totalSat: 2000 });
  expect(s.quotePaymentFee).toHaveBeenCalledWith({ method: 'spark', destination: 'sparkt1abc', amountSats: 2000 });
  // The destination changed since the quote: refused before sending.
  await expect(account.execute!(sparkPreview('sparkt1other'), sparkRoute, quote, 'd0')).rejects.toBeInstanceOf(PaymentNotSentError);
  await expect(account.execute!(sparkPreview(), sparkRoute, quote, 'd1')).resolves.toEqual({ status: 'pending', reference: 'tx-1' });
  expect(s.sendPayment).toHaveBeenCalledWith({ invoice: 'sparkt1abc', amount: 2000 });
  await expect(account.status!('d1')).resolves.toEqual({ status: 'completed', reference: 'tx-1' });
});

test('stale quotes and disconnected wallets are refused as not sent', async () => {
  const s = spark();
  const account = createSparkTransferAccount(s, 'signet');
  const quote = await account.quote(sparkPreview(), sparkRoute);
  await expect(account.execute!(sparkPreview(), sparkRoute, { ...quote, expiresAt: now() - 1 }, 'e1')).rejects.toBeInstanceOf(PaymentNotSentError);
  s.connected = false;
  await expect(account.execute!(sparkPreview(), sparkRoute, quote, 'e2')).rejects.toThrow('not connected');
  await expect(account.quote(sparkPreview(), sparkRoute)).rejects.toThrow('not connected');
  await expect(account.status!('never')).resolves.toEqual({ status: 'unknown' });
  expect(s.sendPayment).not.toHaveBeenCalled();
});

test('through the engine: registered accounts quote and pay a Lightning invoice', async () => {
  const s = spark();
  const disconnect = connectSparkPayAccounts(s, 'signet');
  try {
    const preview = previewTarget({ kind: 'bolt11', raw: 'fixed', invoice: 'fixed', amountSat: 5000, networks: ['signet'] }, undefined, 'req-1');
    expect(preview.plan.status).toBe('ready');
    const offers = await quotePaymentOffers(preview);
    const offer = offers.find(o => o.route.sourceId === 'spark-ln')!;
    expect(offer.quote?.totalSat).toBe(5007);
    await expect(executePaymentOffer(preview, offer, 'engine-1')).resolves.toEqual({ status: 'completed', reference: 'ln-1' });
  } finally { disconnect(); }
  expect(previewTarget({ kind: 'bolt11', raw: 'fixed', invoice: 'fixed', amountSat: 5000, networks: ['signet'] }, undefined, 'req-2').plan.status).toBe('unsupported');
});

test('optionally registers the existing on-chain withdrawal account', () => {
  const s = { ...spark(), createPaymentAccount: jest.fn(() => ({ source: { id: 'spark-wallet-1', rail: 'spark:mainnet', network: 'mainnet' as const }, swaps: [], quote: jest.fn() })) };
  const disconnect = connectSparkPayAccounts(s, 'mainnet', { onchainWalletId: 1 });
  expect(s.createPaymentAccount).toHaveBeenCalledWith(1);
  disconnect();
});

describe('Spark tokens', () => {
  const usdb = { id: 'btkn1usdb', ticker: 'USDB', precision: 6 };
  const tokenSpark = (available = 5_000_000) => ({
    ...spark(),
    listAssets: jest.fn(async () => [
      { id: 'BTC', ticker: 'BTC', precision: 8, balance: { available: 1 } },
      { id: usdb.id, ticker: 'USDB', name: 'USDB', precision: 6, balance: { available } },
    ]),
    sendAsset: jest.fn(async () => ({ txId: 'tok-1' })),
  });
  const tokenPreview = (amount: number, sparkAddress = 'sparkt1abc') => ({
    code: { kind: 'spark', raw: sparkAddress, sparkAddress },
    request: { id: 'r', network: 'signet', networks: ['signet'], amountSat: 0, acceptedRails: ['spark'], asset: { ...usdb, amount } },
    plan: {}, addresses: {},
  }) as unknown as Preview;
  const tokenRoute = { kind: 'direct', sourceId: 'spark-token', from: 'spark:signet', to: 'spark:signet' } as Route;

  test('lists held tokens, never BTC', async () => {
    const { sparkTokens } = require('./sparkPay');
    expect(await sparkTokens(tokenSpark())).toEqual([{ ...usdb, name: 'USDB', available: 5_000_000 }]);
    expect(await sparkTokens(tokenSpark(0))).toEqual([]);
  });

  test('quotes a token transfer at no fee and sends exactly what was quoted', async () => {
    const { createSparkTokenAccount } = require('./sparkPay');
    const w = tokenSpark();
    const account = createSparkTokenAccount(w, 'signet', usdb);
    const q = await account.quote(tokenPreview(2_500_000), tokenRoute);
    expect(q.spend).toEqual({ asset: usdb, amount: 2_500_000, fee: 0, total: 2_500_000 });
    expect(await account.execute!(tokenPreview(2_500_000), tokenRoute, q, 'a1')).toEqual({ status: 'completed', reference: 'tok-1' });
    expect(w.sendAsset).toHaveBeenCalledWith({ assetId: usdb.id, amount: 2_500_000, recipientId: 'sparkt1abc' });
  });

  test('refuses more than the token balance', async () => {
    const { createSparkTokenAccount } = require('./sparkPay');
    const account = createSparkTokenAccount(tokenSpark(1_000_000), 'signet', usdb);
    await expect(account.quote(tokenPreview(2_000_000), tokenRoute)).rejects.toThrow('Not enough balance in Spark');
  });

  test('a token request to a Spark address is planned only on the token account', async () => {
    const { registerSparkTokenPayment } = require('./sparkPay');
    const off = connectSparkPayAccounts(tokenSpark(), 'signet');
    const unregister = registerSparkTokenPayment(usdb);
    const preview = previewTarget({ kind: 'spark', raw: 'sparkt1abc', sparkAddress: 'sparkt1abc', networks: ['signet'] } as any, undefined, 'r', { asset: { ...usdb, amount: 1_000_000 } });
    expect(preview.request.acceptedRails).toEqual(['spark']);
    expect(preview.plan.status === 'ready' && [preview.plan.route, ...preview.plan.alternatives].map(r => r.sourceId)).toEqual(['spark-token']);
    const offers = await quotePaymentOffers(preview);
    expect(offers[0].quote?.spend?.asset.ticker).toBe('USDB');
    unregister(); off();
  });
});
