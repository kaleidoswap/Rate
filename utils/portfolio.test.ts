import { assetUsdValue, breakdownAssetRows, tokenUsdPrice, tokenValueSats, tokenValueUsd, usdToSats } from './portfolio';

const asset = (ticker: string, baseUnits: number, precision = 6, asset_id = ticker) =>
  ({ asset_id, ticker, precision, balance: { spendable: baseUnits } });

test('every dollar stablecoin is worth $1, whatever the case', () => {
  for (const t of ['USDT', 'USDt', 'usdc', 'USDB', 'DAI', 'BUSD', 'USD']) expect(tokenUsdPrice(t)).toBe(1);
  expect(tokenUsdPrice('XAUT')).toBeNull();
  expect(tokenUsdPrice(undefined)).toBeNull();
});

test('an asset is valued from the same balance its row shows', () => {
  expect(assetUsdValue(asset('USDT', 12_500_000))).toBe(12.5);
  expect(assetUsdValue(asset('XAUT', 1_000_000))).toBeUndefined();
  // Known dollar assets count even when their ticker says otherwise.
  expect(assetUsdValue(asset('L-USD', 2_000_000, 6, 'liquid-usdt'), new Set(['liquid-usdt']))).toBe(2);
});

test('the token value joins the total as sats at the live price', () => {
  const assets = [asset('USDT', 30_000_000), asset('USDB', 20_000_000, 6), asset('XAUT', 5)];
  expect(tokenValueUsd(assets)).toBe(50);
  // $50 at $100,000/BTC = 50,000 sats.
  expect(tokenValueSats(assets, 100_000)).toBe(50_000);
});

test('no price, no token value', () => {
  expect(tokenValueSats([asset('USDT', 1_000_000)], 0)).toBe(0);
  expect(usdToSats(10, NaN)).toBe(0);
});

test('BTC rows and empty balances add nothing', () => {
  expect(tokenValueUsd([{ asset_id: 'BTC', ticker: 'USD', precision: 0, balance: 100 }, asset('USDC', 0)])).toBe(0);
});

describe('breakdownAssetRows', () => {
  const assets = [
    { asset_id: 'BTC', ticker: 'BTC', precision: 0, balance: { spendable: 1000 } },
    { asset_id: 'rgb:gold', ticker: 'XAUT', name: 'Gold', precision: 0, balance: { spendable: 3 } },
    { asset_id: 'rgb:usdt', ticker: 'USDT', name: 'Tether USD', precision: 6, balance: { spendable: 12_500_000 } },
    { asset_id: 'btkn1usdb', ticker: 'USDB', name: 'USDB', precision: 6, balance: { spendable: 40_000_000 } },
    { asset_id: 'rgb:empty', ticker: 'NIL', precision: 0, balance: { spendable: 0 } },
  ];

  test('one row per held asset, priced first by value, with its network', () => {
    const rows = breakdownAssetRows(assets);
    expect(rows.map((r) => r.ticker)).toEqual(['USDB', 'USDT', 'XAUT']);
    expect(rows[0]).toMatchObject({ network: 'spark', networkLabel: 'Spark', amount: '40', usdValue: 40 });
    expect(rows[1]).toMatchObject({ network: 'rgb', networkLabel: 'RGB', amount: '12.5', usdValue: 12.5, name: 'Tether USD' });
    expect(rows[2]).toMatchObject({ amount: '3', usdValue: undefined });
  });

  test('rows add up to the token value counted in the total', () => {
    const sum = breakdownAssetRows(assets).reduce((s, r) => s + (r.usdValue ?? 0), 0);
    expect(sum).toBe(tokenValueUsd(assets));
  });

  test('Lite folds the dollar tokens into one US Dollar row', () => {
    const rows = breakdownAssetRows(assets, undefined, { foldDollars: true });
    expect(rows.map((r) => r.ticker)).toEqual(['USD', 'XAUT']);
    expect(rows[0]).toMatchObject({ name: 'US Dollar', amount: '52.50', usdValue: 52.5 });
    expect(rows[0].network).toBeUndefined();
  });
});
