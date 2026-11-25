import { assetUsdValue, breakdownAssetRows, tokenUsdPrice, tokenValueSats, tokenValueUsd, usdToSats } from './portfolio';
import { LIQUID_USDT_ASSET_ID } from '@kaleidorg/wallet-engine';
import { USDB_TOKEN_ADDRESS } from './flashnet';

const asset = (ticker: string, baseUnits: number, precision = 6, asset_id = ticker) =>
  ({ asset_id, ticker, precision, balance: { spendable: baseUnits } });

test('prices only trusted mainnet asset IDs', () => {
  expect(tokenUsdPrice({ asset_id: LIQUID_USDT_ASSET_ID })).toBe(1);
  expect(tokenUsdPrice({ asset_id: LIQUID_USDT_ASSET_ID, protocol: 'RGB' })).toBeUndefined();
  expect(tokenUsdPrice({ asset_id: USDB_TOKEN_ADDRESS.mainnet, protocol: 'SPARK' })).toBe(1);
  expect(tokenUsdPrice({ asset_id: USDB_TOKEN_ADDRESS.mainnet, protocol: 'RGB' })).toBeUndefined();
  expect(tokenUsdPrice({ asset_id: USDB_TOKEN_ADDRESS.mainnet }, new Set(['SPARK']))).toBeUndefined();
  expect(tokenUsdPrice({ asset_id: 'rgb:usdt' })).toBeUndefined();
  expect(tokenUsdPrice({})).toBeUndefined();
});

test('an asset is valued from the same balance its row shows', () => {
  expect(assetUsdValue(asset('USDT', 12_500_000, 6, LIQUID_USDT_ASSET_ID))).toBe(12.5);
  expect(assetUsdValue(asset('XAUT', 1_000_000))).toBeUndefined();
  // Known dollar assets count even when their ticker says otherwise.
  expect(assetUsdValue(asset('L-USD', 2_000_000, 6, LIQUID_USDT_ASSET_ID))).toBe(2);
  expect(assetUsdValue(asset('USDT', 2_000_000, 6, 'rgb:unverified'))).toBeUndefined();
});

test('the token value joins the total as sats at the live price', () => {
  const assets = [asset('USDT', 30_000_000, 6, LIQUID_USDT_ASSET_ID), asset('USDB', 20_000_000, 6, USDB_TOKEN_ADDRESS.mainnet), asset('XAUT', 5)];
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
    { asset_id: LIQUID_USDT_ASSET_ID, ticker: 'USDT', name: 'Tether USD', precision: 6, balance: { spendable: 12_500_000 }, protocol: 'LIQUID' },
    { asset_id: USDB_TOKEN_ADDRESS.mainnet, ticker: 'USDB', name: 'USDB', precision: 6, balance: { spendable: 40_000_000 } },
    { asset_id: 'rgb:empty', ticker: 'NIL', precision: 0, balance: { spendable: 0 } },
  ];

  test('one row per held asset, priced first by value, with its network', () => {
    const rows = breakdownAssetRows(assets);
    expect(rows.map((r) => r.ticker)).toEqual(['USDB', 'USDT', 'XAUT']);
    expect(rows[0]).toMatchObject({ network: 'spark', networkLabel: 'Spark', amount: '40', usdValue: 40 });
    expect(rows[1]).toMatchObject({ network: 'liquid', networkLabel: 'Liquid', amount: '12.5', usdValue: 12.5, name: 'Tether USD' });
    expect(rows[2]).toMatchObject({ amount: '3', usdValue: undefined });
  });

  test('rows add up to the token value counted in the total', () => {
    const sum = breakdownAssetRows(assets).reduce((s, r) => s + (r.usdValue ?? 0), 0);
    expect(sum).toBe(tokenValueUsd(assets));
  });

  test('Lite folds just the designated dollar holding', () => {
    const rows = breakdownAssetRows(assets, { foldedUsdAssetIds: new Set([LIQUID_USDT_ASSET_ID]) });
    expect(rows.map((r) => r.ticker)).toEqual(['USD', 'USDB', 'XAUT']);
    expect(rows[0]).toMatchObject({ name: 'US Dollar', amount: '12.50', usdValue: 12.5 });
    expect(rows[0].network).toBeUndefined();
  });
});
