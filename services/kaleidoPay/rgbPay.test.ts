jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockInvoices: Record<string, { amountSats?: number; timestamp: number }> = {};
jest.mock('../../utils/decodeInvoice', () => ({ decodeBolt11: (invoice: string) => ({ amountSats: mockInvoices[invoice]?.amountSats }) }));
jest.mock('light-bolt11-decoder', () => ({ decode: (invoice: string) => ({ sections: [{ name: 'timestamp', value: mockInvoices[invoice].timestamp }] }) }));
import { connectRgbPayAccounts, createRgbLightningAccount, createRgbOnchainAccount, registerRgbAssetPayment, rgbLightningFeeEstimate, rgbRequestAsset, RGB_ONCHAIN_VBYTES } from './rgbPay';
import { executePaymentOffer, PaymentNotSentError, previewTarget, quotePaymentOffers } from './index';
import type { Preview, Route } from './index';

const now = () => Math.floor(Date.now() / 1000);
mockInvoices.fixed = { amountSats: 4000, timestamp: now() };
mockInvoices.open = { timestamp: now() };

const lnRoute = { kind: 'direct', sourceId: 'rgb-ln', from: 'ln:regtest', to: 'ln:regtest' } as Route;
const btcRoute = { kind: 'direct', sourceId: 'rgb-btc', from: 'btc:regtest', to: 'btc:regtest' } as Route;
const lnPreview = (invoice: string, amountSat = 4000) => ({ code: { kind: 'bolt11', raw: invoice, invoice }, request: { id: 'r', network: 'regtest', networks: ['regtest'], amountSat, acceptedRails: ['ln'] }, plan: {}, addresses: {} }) as unknown as Preview;
const btcPreview = (address = 'bcrt1qdest', amountSat = 10000) => ({ code: { kind: 'bitcoin', raw: address, address }, request: { id: 'r', network: 'regtest', networks: ['regtest'], amountSat, acceptedRails: ['btc'] }, plan: {}, addresses: {} }) as unknown as Preview;
const USDT = { id: 'rgb:usdt', ticker: 'USDT', precision: 6 };

function node(opts: { nwc?: boolean; balance?: number; channels?: any[] } = {}) {
  return {
    connected: true,
    isConnected: jest.fn(function (this: any) { return this.connected; }),
    ...(opts.nwc ? { walletType: () => 'rln' as const } : {}),
    getBtcBalance: jest.fn().mockResolvedValue({ confirmed: opts.balance ?? 100000 }),
    listChannels: jest.fn().mockResolvedValue(opts.channels ?? []),
    sendPayment: jest.fn().mockResolvedValue({ paymentHash: '', preimage: 'pre', status: 'confirmed' }),
    getPaymentStatus: jest.fn().mockResolvedValue({ status: 'confirmed' }),
    sendBtcOnchain: jest.fn().mockResolvedValue({ txid: 'btc-tx' }),
    decodeRgbInvoice: jest.fn().mockResolvedValue({ asset_id: USDT.id, assignment: { type: 'Fungible', value: 2500000 } }),
    sendAsset: jest.fn().mockResolvedValue({ txid: 'rgb-tx' }),
    getAssetBalance: jest.fn().mockResolvedValue({ available: 9000000, offchain_outbound: 1000000 }),
    getAsset: jest.fn().mockResolvedValue({ id: USDT.id, ticker: 'USDT', precision: 6 }),
    getTransaction: jest.fn().mockResolvedValue({ status: 'confirmed' }),
  };
}

test('Lightning over NWC: spendable is the wallet balance; the fee is a marked estimate', async () => {
  const n = node({ nwc: true, balance: 4000 + rgbLightningFeeEstimate(4000) });
  const account = createRgbLightningAccount(n, 'regtest');
  const [option] = await account.quoteOptions!(lnPreview('fixed'), lnRoute);
  expect(option.quote).toMatchObject({ recipientSat: 4000, feeSat: 40, totalSat: 4040 });
  expect(option.detail).toContain('Estimated');
  await expect(account.execute!(lnPreview('fixed'), lnRoute, option.quote!, 'a1')).resolves.toEqual({ status: 'completed', reference: 'pre' });
  expect(n.sendPayment).toHaveBeenCalledWith({ invoice: 'fixed' });
  expect(n.listChannels).not.toHaveBeenCalled();
  n.getBtcBalance.mockResolvedValue({ confirmed: 4039 });
  await expect(account.quote(lnPreview('fixed'), lnRoute)).rejects.toThrow('Not enough balance in RGB node');
});

test('Lightning on a raw node: spendable is channel outbound capacity; amountless passes the amount', async () => {
  const n = node({ channels: [{ ready: true, is_usable: true, local_balance_sat: 3000, outbound_balance_msat: 3000000 }] });
  const account = createRgbLightningAccount(n, 'regtest');
  await expect(account.quote(lnPreview('open', 3000), lnRoute)).rejects.toThrow('Not enough balance');
  const quote = await account.quote(lnPreview('open', 2000), lnRoute);
  n.sendPayment.mockResolvedValueOnce({ paymentHash: 'h1', status: 'pending' });
  await expect(account.execute!(lnPreview('open', 2000), lnRoute, quote, 'b1')).resolves.toEqual({ status: 'pending', reference: 'h1' });
  expect(n.sendPayment).toHaveBeenCalledWith({ invoice: 'open', amount: 2000 });
  await expect(account.status!('b1')).resolves.toEqual({ status: 'completed', reference: 'h1' });
  expect(n.getPaymentStatus).toHaveBeenCalledWith('h1');
});

test('on-chain: sends sats at the quoted fee rate and follows the txid', async () => {
  const n = node();
  const account = createRgbOnchainAccount(n, 'regtest', { feeRate: () => 5 });
  const quote = await account.quote(btcPreview(), btcRoute);
  expect(quote).toMatchObject({ recipientSat: 10000, feeSat: 5 * RGB_ONCHAIN_VBYTES, totalSat: 10000 + 5 * RGB_ONCHAIN_VBYTES });
  await expect(account.execute!(btcPreview('bcrt1qother'), btcRoute, quote, 'c0')).rejects.toBeInstanceOf(PaymentNotSentError);
  await expect(account.execute!(btcPreview(), btcRoute, quote, 'c1')).resolves.toEqual({ status: 'pending', reference: 'btc-tx' });
  expect(n.sendBtcOnchain).toHaveBeenCalledWith({ address: 'bcrt1qdest', amount: 10000, feeRate: 5 });
  await expect(account.status!('c1')).resolves.toEqual({ status: 'completed', reference: 'btc-tx' });
  // Stale quote: refused before anything is sent.
  const stale = await account.quote(btcPreview(), btcRoute);
  await expect(account.execute!(btcPreview(), btcRoute, { ...stale, expiresAt: now() - 1 }, 'c2')).rejects.toBeInstanceOf(PaymentNotSentError);
  expect(n.sendBtcOnchain).toHaveBeenCalledTimes(1);
  n.getBtcBalance.mockResolvedValue({ confirmed: 10000 });
  await expect(account.quote(btcPreview(), btcRoute)).rejects.toThrow('Not enough balance in RGB node');
});

test('RGB invoice: decodes the asset, quotes in base units, and pays it through the engine', async () => {
  const n = node({ nwc: true });
  const disconnect = connectRgbPayAccounts(n, 'regtest');
  try {
    const asset = await rgbRequestAsset(n, 'rgb:invoice');
    expect(asset).toEqual({ ...USDT, amount: 2500000 });
    const unregisterAsset = registerRgbAssetPayment({ id: asset.id, ticker: asset.ticker, precision: asset.precision });
    const preview = previewTarget({ kind: 'rgb', raw: 'rgb:invoice', rgbInvoice: 'rgb:invoice' }, undefined, 'req-rgb', { asset, networks: ['regtest'] });
    const [offer] = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'rgb-asset');
    expect(offer.unavailable).toBeUndefined();
    expect(offer.quote).toMatchObject({ recipientSat: 0, spend: { asset: USDT, amount: 2500000, fee: 0, total: 2500000 } });
    expect(offer.providerDetail).toContain('network fee');
    await expect(executePaymentOffer(preview, offer, 'rgb-1')).resolves.toEqual({ status: 'pending', reference: 'rgb-tx' });
    expect(n.sendAsset).toHaveBeenCalledWith({ asset_id: USDT.id, recipientId: 'rgb:invoice', amount: 2500000 });
    // More than the on-chain asset balance (available less channel funds) is refused.
    const big = previewTarget({ kind: 'rgb', raw: 'rgb:invoice', rgbInvoice: 'rgb:invoice' }, undefined, 'req-rgb2', { asset: { ...asset, amount: 8000001 }, networks: ['regtest'] });
    n.decodeRgbInvoice.mockResolvedValueOnce({ asset_id: USDT.id });
    const [refused] = (await quotePaymentOffers(big)).filter(o => o.route.sourceId === 'rgb-asset');
    expect(refused.unavailable).toBe('Not enough balance in RGB node');
    unregisterAsset();
  } finally { disconnect(); }
  expect(() => registerRgbAssetPayment(USDT)).toThrow('not connected');
});

test('a plain Lightning NWC wallet registers only Lightning', async () => {
  const n = { ...node(), walletType: () => 'ln' as const };
  const disconnect = connectRgbPayAccounts(n, 'regtest');
  try {
    const preview = previewTarget({ kind: 'bitcoin', raw: 'x', address: 'bcrt1qdest', networks: ['regtest'] }, 1000, 'req-btc');
    expect(preview.plan.status).toBe('unsupported');
    expect(() => registerRgbAssetPayment(USDT)).toThrow('not connected');
  } finally { disconnect(); }
});
