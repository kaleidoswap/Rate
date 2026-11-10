jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockFeeRates = jest.fn(async () => ({ slow: 1, normal: 2, fast: 5, live: false }));
jest.mock('../rgbWallet', () => ({ rgbFeeRates: () => mockFeeRates(), DEFAULT_RGB_FEE_RATES: { slow: 1, normal: 2, fast: 5, live: false } }));
import { connectRgbL1PayAccounts, networkFeeRates, rgbL1FeeOptions, rgbL1PayAdapter, rgbL1TransferStatus, setRgbL1FeeSpeed } from './rgbL1Pay';
import { connectRgbPayAccounts, currentRgbPayAdapter, registerRgbAssetPayment, rgbRequestAsset } from './rgbPay';
import { checkPaymentStatus, executePaymentOffer, previewTarget, quotePaymentOffers } from './index';

const USDT = { id: 'rgb:usdt', ticker: 'USDT', precision: 6 };

// The engine's RGB_L1 adapter, as connected through rgb-lib on the phone.
function l1() {
  return {
    isConnected: () => true,
    getBtcBalance: jest.fn(async () => ({ confirmed: 100000, unconfirmed: 0, total: 100000 })),
    sendBtcOnchain: jest.fn(async () => ({ ok: true, txid: 'btc-tx' })),
    sendAsset: jest.fn(async () => ({ txid: 'rgb-tx', batchTransferIdx: 1 })),
    getAssetBalance: jest.fn(async () => ({ available: 9_000_000, total: 9_000_000 })),
    listAssets: jest.fn(async () => [{ id: 'BTC' }, USDT]),
    getAsset: jest.fn(async () => USDT),
    getTransaction: jest.fn(async () => ({ status: 'pending' })),
    account: { refreshTransfers: jest.fn(async () => true), listTransfers: jest.fn(async (_id: string): Promise<any[]> => []), decodeRgbInvoice: jest.fn(async () => ({ asset_id: USDT.id, assignment: { type: 'Fungible', value: 2_500_000 } })) },
  };
}

test('pays an RGB invoice from the phone wallet: decoded on the device, sent through rgb-lib', async () => {
  const wallet = l1();
  const disconnect = connectRgbL1PayAccounts(wallet, 'mutinynet');
  try {
    expect(currentRgbPayAdapter()).not.toBeNull();
    const asset = await rgbRequestAsset(currentRgbPayAdapter()!, 'rgb:invoice');
    expect(asset).toEqual({ ...USDT, amount: 2_500_000 });
    const unregister = registerRgbAssetPayment(USDT);
    const preview = previewTarget({ kind: 'rgb', raw: 'rgb:invoice', rgbInvoice: 'rgb:invoice' }, undefined, 'req-l1', { asset, networks: ['mutinynet'] });
    const [offer] = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'rgb-asset');
    expect(offer.unavailable).toBeUndefined();
    expect(offer.accountName).toBe('RGB wallet');
    await expect(executePaymentOffer(preview, offer, 'l1-1')).resolves.toEqual({ status: 'pending', reference: 'rgb-tx' });
    expect(wallet.sendAsset).toHaveBeenCalledWith({ token: USDT.id, recipient: 'rgb:invoice', amount: 2_500_000, feeRate: 2 });
    unregister();
  } finally { disconnect(); }
  expect(currentRgbPayAdapter()).toBeNull();
});

test('no Lightning from the phone wallet; on-chain bitcoin goes through rgb-lib', async () => {
  const wallet = l1();
  const disconnect = connectRgbL1PayAccounts(wallet, 'mutinynet');
  try {
    const ln = previewTarget({ kind: 'bolt11', raw: 'lntb1', invoice: 'lntb1', networks: ['mutinynet'] } as any, 1000, 'req-ln');
    expect((await quotePaymentOffers(ln)).some(o => o.route.sourceId === 'rgb-ln')).toBe(false);
    const btc = previewTarget({ kind: 'bitcoin', raw: 'tb1qdest', address: 'tb1qdest', networks: ['mutinynet'] }, 10000, 'req-btc');
    const [offer] = (await quotePaymentOffers(btc)).filter(o => o.route.sourceId === 'rgb-btc');
    expect(offer.unavailable).toBeUndefined();
    await expect(executePaymentOffer(btc, offer, 'l1-2')).resolves.toEqual({ status: 'pending', reference: 'btc-tx' });
    expect(wallet.sendBtcOnchain).toHaveBeenCalledWith({ address: 'tb1qdest', amount: 10000, feeRate: 2 });
  } finally { disconnect(); }
  await expect(rgbL1PayAdapter(wallet).sendPayment({ invoice: 'x' })).rejects.toThrow(/no Lightning/);
});

test('RGB on this phone reads the network’s fee rates at most every 10 minutes', async () => {
  let t = 0;
  mockFeeRates.mockClear();
  mockFeeRates.mockResolvedValueOnce({ slow: 3, normal: 7, fast: 12, live: true });
  const rates = networkFeeRates({}, () => t);
  expect(rates()).toBeUndefined();
  await Promise.resolve(); await Promise.resolve();
  expect(rates()).toEqual({ slow: 3, normal: 7, fast: 12, live: true });
  t = 9 * 60_000;
  rates();
  expect(mockFeeRates).toHaveBeenCalledTimes(1);
  t = 11 * 60_000;
  rates();
  expect(mockFeeRates).toHaveBeenCalledTimes(2);

  const wallet = l1();
  await rgbL1PayAdapter(wallet, () => 7).sendAsset!({ asset_id: USDT.id, recipientId: 'rgb:invoice', amount: 1 });
  expect(wallet.sendAsset).toHaveBeenCalledWith({ token: USDT.id, recipient: 'rgb:invoice', amount: 1, feeRate: 7 });
});

test('Send pays RGB on this phone at the chosen speed: Normal by default, the quote and the send agree', async () => {
  mockFeeRates.mockResolvedValue({ slow: 3, normal: 7, fast: 12, live: true });
  expect(rgbL1FeeOptions()).toBeNull();
  const wallet = l1();
  const disconnect = connectRgbL1PayAccounts(wallet, 'mutinynet');
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(rgbL1FeeOptions()).toEqual([
      { speed: 'slow', rate: 3, feeSat: 900, live: true },
      { speed: 'normal', rate: 7, feeSat: 2100, live: true },
      { speed: 'fast', rate: 12, feeSat: 3600, live: true },
    ]);
    const btc = previewTarget({ kind: 'bitcoin', raw: 'tb1qdest', address: 'tb1qdest', networks: ['mutinynet'] }, 10000, 'req-speed');
    const normal = (await quotePaymentOffers(btc)).find(o => o.route.sourceId === 'rgb-btc')!;
    expect(normal.quote?.feeSat).toBe(2100);
    setRgbL1FeeSpeed('fast');
    const fast = (await quotePaymentOffers(btc)).find(o => o.route.sourceId === 'rgb-btc')!;
    expect(fast.quote?.feeSat).toBe(3600);
    expect(fast.providerDetail).toMatch(/12 sat\/vB/);
    await executePaymentOffer(btc, fast, 'speed-1');
    expect(wallet.sendBtcOnchain).toHaveBeenCalledWith({ address: 'tb1qdest', amount: 10000, feeRate: 12 });

    setRgbL1FeeSpeed('slow');
    const unregister = registerRgbAssetPayment(USDT);
    const asset = await rgbRequestAsset(currentRgbPayAdapter()!, 'rgb:invoice');
    const rgb = previewTarget({ kind: 'rgb', raw: 'rgb:invoice', rgbInvoice: 'rgb:invoice' }, undefined, 'req-speed-asset', { asset, networks: ['mutinynet'] });
    const slow = (await quotePaymentOffers(rgb)).find(o => o.route.sourceId === 'rgb-asset')!;
    expect(slow.quote?.feeSat).toBe(900);
    setRgbL1FeeSpeed('fast'); // a change after the quote doesn't alter what was reviewed
    await executePaymentOffer(rgb, slow, 'speed-2');
    expect(wallet.sendAsset).toHaveBeenLastCalledWith({ token: USDT.id, recipient: 'rgb:invoice', amount: 2_500_000, feeRate: 3 });
    unregister();
  } finally {
    setRgbL1FeeSpeed('normal');
    disconnect();
    mockFeeRates.mockReset();
    mockFeeRates.mockImplementation(async () => ({ slow: 1, normal: 2, fast: 5, live: false }));
  }
  expect(rgbL1FeeOptions()).toBeNull();
});


test('an invoice without an asset can use an explicitly chosen owned asset', async () => {
  const wallet = l1();
  wallet.account.decodeRgbInvoice.mockResolvedValue({ asset_id: undefined, assignment: undefined } as any);
  const adapter = rgbL1PayAdapter(wallet);
  const asset = await rgbRequestAsset(adapter, 'rgb:any', 1000000, USDT.id);
  expect(asset).toEqual({ ...USDT, amount: 1000000 });
  const off = connectRgbL1PayAccounts(wallet, 'mutinynet');
  const unregister = registerRgbAssetPayment(USDT);
  try {
    const p = previewTarget({ kind: 'rgb', raw: 'rgb:any', rgbInvoice: 'rgb:any' }, undefined, 'assetless', { asset, networks: ['mutinynet'] });
    const offer = (await quotePaymentOffers(p)).find(o => o.route.sourceId === 'rgb-asset')!;
    expect(offer.unavailable).toBeUndefined();
    await executePaymentOffer(p, offer, 'assetless-send');
    expect(wallet.sendAsset).toHaveBeenCalledWith(expect.objectContaining({ token: USDT.id, recipient: 'rgb:any', amount: 1000000 }));
  } finally { unregister(); off(); }
});


test('disconnecting an RLN account keeps the connected phone wallet available', async () => {
  const wallet = l1();
  const offPhone = connectRgbL1PayAccounts(wallet, 'mutinynet');
  const node = { ...rgbL1PayAdapter(l1()), isConnected: () => true };
  const offNode = connectRgbPayAccounts(node, 'mutinynet');
  expect(currentRgbPayAdapter()).not.toBe(node);
  offNode();
  expect(currentRgbPayAdapter()?.isConnected()).toBe(true);
  const p = previewTarget({ kind: 'bitcoin', raw: 'tb1qdest', address: 'tb1qdest', networks: ['mutinynet'] }, 10000, 'after-node-disconnect');
  const offers = await quotePaymentOffers(p);
  expect(offers.find(o => o.route.sourceId === 'rgb-btc')).toMatchObject({ accountName: 'RGB wallet', executable: true });
  offPhone();
  expect(currentRgbPayAdapter()).toBeNull();
});


test('quotes native BTC from spendable funds, excluding already committed inputs', async () => {
  const wallet = l1();
  wallet.getBtcBalance.mockResolvedValue({ confirmed: 100000, unconfirmed: 0, total: 500 });
  expect(await rgbL1PayAdapter(wallet).getBtcBalance()).toEqual({ confirmed: 500 });
  const off = connectRgbL1PayAccounts(wallet, 'mutinynet');
  try {
    const p = previewTarget({ kind: 'bitcoin', raw: 'tb1qdest', address: 'tb1qdest', networks: ['mutinynet'] }, 10000, 'locked-btc');
    const offer = (await quotePaymentOffers(p)).find(o => o.route.sourceId === 'rgb-btc');
    expect(offer?.unavailable).toBeTruthy();
    expect(wallet.sendBtcOnchain).not.toHaveBeenCalled();
  } finally { off(); }
});


test('RGB follow refreshes the handshake, reports ACK/block waits, and recovers after reconnect', async () => {
  const wallet = l1();
  let off = connectRgbL1PayAccounts(wallet, 'mutinynet');
  const unregister = registerRgbAssetPayment(USDT);
  try {
    const asset = { ...USDT, amount: 2_500_000 };
    const preview = previewTarget({ kind: 'rgb', raw: 'rgb:invoice', rgbInvoice: 'rgb:invoice' }, undefined, 'handshake', { asset, networks: ['mutinynet'] });
    const offer = (await quotePaymentOffers(preview)).find(o => o.route.sourceId === 'rgb-asset')!;
    await executePaymentOffer(preview, offer, 'handshake');
    wallet.account.listTransfers.mockResolvedValue([{ txid: 'rgb-tx', status: 'WaitingCounterparty' }]);
    expect(await checkPaymentStatus('rgb-asset', 'handshake')).toMatchObject({ status: 'pending', detail: expect.stringContaining('open and sync') });
    expect(wallet.account.refreshTransfers).toHaveBeenCalled();
    expect(wallet.account.listTransfers).not.toHaveBeenCalledWith('BTC');
    unregister(); off();
    off = connectRgbL1PayAccounts(wallet, 'mutinynet');
    wallet.account.listTransfers.mockResolvedValue([{ txid: 'rgb-tx', status: 'WAITING_CONFIRMATIONS' }]);
    expect(await checkPaymentStatus('rgb-asset', 'handshake')).toMatchObject({ status: 'pending', detail: expect.stringContaining('Bitcoin confirmations') });
    wallet.account.refreshTransfers.mockRejectedValueOnce(new Error('offline'));
    expect(await checkPaymentStatus('rgb-asset', 'handshake')).toMatchObject({ status: 'unknown' });
    wallet.account.listTransfers.mockResolvedValue([{ txid: 'rgb-tx', status: 'Settled' }]);
    expect(await checkPaymentStatus('rgb-asset', 'handshake')).toMatchObject({ status: 'completed' });
    expect(wallet.sendAsset).toHaveBeenCalledTimes(1);
    expect(wallet.getTransaction).not.toHaveBeenCalled();
  } finally { unregister(); off(); }
});


test('missing and failed RGB transfers never use Bitcoin confirmation as proof of delivery', async () => {
  const wallet = l1();
  wallet.getTransaction.mockResolvedValue({ status: 'confirmed' });
  expect(await rgbL1TransferStatus(wallet, 'missing')).toMatchObject({ status: 'pending' });
  wallet.account.listTransfers.mockResolvedValue([{ txid: 'failed-tx', status: 'Failed' }]);
  expect(await rgbL1TransferStatus(wallet, 'failed-tx')).toMatchObject({ status: 'failed' });
  expect(wallet.getTransaction).not.toHaveBeenCalled();
});

test.each([
  ['WAITING_SAFE_HEIGHT', 'safety height'],
  ['WAITING_BROADCAST', 'broadcast'],
])('explains the native beta.7 phase %s', async (status, message) => {
  const wallet = l1();
  wallet.account.listTransfers.mockResolvedValue([{ txid: 'rgb-tx', status }]);
  expect(await rgbL1TransferStatus(wallet, 'rgb-tx')).toMatchObject({ status: 'pending', detail: expect.stringContaining(message) });
});

test.each([
  ['ERR_RGB_INSUFFICIENT_ALLOCATION_SLOTS', /UTXOs/],
  ['ERR_RGB_INSUFFICIENT_BITCOINS', /Not enough bitcoin/],
  ['RGB_INVOICE_INVALID', /expired/],
])('definite refusal is not an uncertain payment: %s', async (code, message) => {
  const { PaymentNotSentError } = require('./errors');
  const wallet = l1();
  wallet.sendAsset.mockRejectedValueOnce(Object.assign(new Error('expired'), { code }));
  const pending = rgbL1PayAdapter(wallet).sendAsset!({ asset_id: USDT.id, recipientId: 'invoice', amount: 25 });
  await expect(pending).rejects.toBeInstanceOf(PaymentNotSentError);
  await expect(pending).rejects.toThrow(message);
  expect(wallet.sendAsset).toHaveBeenCalledTimes(1);
});

test('a transport failure is never classified as definitely unpaid or retried', async () => {
  const wallet = l1();
  const error = Object.assign(new Error('connection lost'), { code: 'ERR_RGB_PROXY' });
  wallet.sendAsset.mockRejectedValueOnce(error);
  await expect(rgbL1PayAdapter(wallet).sendAsset!({ asset_id: USDT.id, recipientId: 'invoice', amount: 25 })).rejects.toThrow(/ERR_RGB_PROXY.*Check your connection/);
  expect(wallet.sendAsset).toHaveBeenCalledTimes(1);
});

test.each([
  [{ expiration_timestamp: 1 }, /expired/],
  [{ network: 'SIGNET' }, /different network/],
])('invalid RGB invoice cannot produce an offer: %j', async (fields, error) => {
  const wallet = l1();
  wallet.account.decodeRgbInvoice.mockResolvedValueOnce({ asset_id: USDT.id, assignment: { type: 'Fungible', value: 2_500_000 }, ...fields } as any);
  const disconnect = connectRgbL1PayAccounts(wallet, 'mutinynet');
  const unregister = registerRgbAssetPayment(USDT);
  try {
    const preview = previewTarget({ kind: 'rgb', raw: 'rgb:invoice', rgbInvoice: 'rgb:invoice' }, undefined, 'invalid-invoice', { asset: { ...USDT, amount: 2_500_000 }, networks: ['mutinynet'] });
    const offer = (await quotePaymentOffers(preview)).find(o => o.route.sourceId === 'rgb-asset')!;
    expect(offer.unavailable).toMatch(error);
    expect(wallet.sendAsset).not.toHaveBeenCalled();
  } finally { unregister(); disconnect(); }
});
