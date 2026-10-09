jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockFeeRates = jest.fn(async () => ({ slow: 1, normal: 2, fast: 5, live: false }));
jest.mock('../rgbWallet', () => ({ rgbFeeRates: () => mockFeeRates(), DEFAULT_RGB_FEE_RATES: { slow: 1, normal: 2, fast: 5, live: false } }));
import { connectRgbL1PayAccounts, networkFeeRates, rgbL1FeeOptions, rgbL1PayAdapter, setRgbL1FeeSpeed } from './rgbL1Pay';
import { currentRgbPayAdapter, registerRgbAssetPayment, rgbRequestAsset } from './rgbPay';
import { executePaymentOffer, previewTarget, quotePaymentOffers } from './index';

const USDT = { id: 'rgb:usdt', ticker: 'USDT', precision: 6 };

// The engine's RGB_L1 adapter, as connected through rgb-lib on the phone.
function l1() {
  return {
    isConnected: () => true,
    getBtcBalance: jest.fn(async () => ({ confirmed: 100000, unconfirmed: 0, total: 100000 })),
    sendBtcOnchain: jest.fn(async () => ({ ok: true, txid: 'btc-tx' })),
    sendAsset: jest.fn(async () => ({ txid: 'rgb-tx', batchTransferIdx: 1 })),
    getAssetBalance: jest.fn(async () => ({ available: 9_000_000, total: 9_000_000 })),
    getAsset: jest.fn(async () => USDT),
    getTransaction: jest.fn(async () => ({ status: 'pending' })),
    account: { decodeRgbInvoice: jest.fn(async () => ({ asset_id: USDT.id, assignment: { type: 'Fungible', value: 2_500_000 } })) },
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
