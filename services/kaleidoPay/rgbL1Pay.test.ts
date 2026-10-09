jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockFeeRates = jest.fn(async () => ({ slow: 1, normal: 2, fast: 5, live: false }));
jest.mock('../rgbWallet', () => ({ rgbFeeRates: () => mockFeeRates() }));
import { connectRgbL1PayAccounts, networkFeeRate, rgbL1PayAdapter } from './rgbL1Pay';
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
    expect(wallet.sendAsset).toHaveBeenCalledWith({ token: USDT.id, recipient: 'rgb:invoice', amount: 2_500_000 });
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

test('RGB on this phone pays at the network’s normal fee rate once known, read at most every 10 minutes', async () => {
  let t = 0;
  mockFeeRates.mockClear();
  mockFeeRates.mockResolvedValueOnce({ slow: 3, normal: 7, fast: 12, live: true });
  const rate = networkFeeRate({}, () => t);
  expect(rate()).toBeUndefined();
  await Promise.resolve(); await Promise.resolve();
  expect(rate()).toBe(7);
  t = 9 * 60_000;
  rate();
  expect(mockFeeRates).toHaveBeenCalledTimes(1);
  t = 11 * 60_000;
  rate();
  expect(mockFeeRates).toHaveBeenCalledTimes(2);

  const wallet = l1();
  await rgbL1PayAdapter(wallet, () => 7).sendAsset!({ asset_id: USDT.id, recipientId: 'rgb:invoice', amount: 1 });
  expect(wallet.sendAsset).toHaveBeenCalledWith({ token: USDT.id, recipient: 'rgb:invoice', amount: 1, feeRate: 7 });
});
