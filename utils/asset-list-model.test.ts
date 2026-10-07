import {
  assetListUsdTotal, availableAssetFilters, buildAssetListItems, dominantHolding, filterAssetItems, LITE_USD_KEY,
} from './asset-list-model';

const token = (asset_id: string, ticker: string, protocol: string, baseUnits: number, precision = 6, name = ticker) =>
  ({ asset_id, ticker, name, precision, protocol, balance: baseUnits });

const base = {
  btcNetworks: { onchain: 10_000, lightning: 0, spark: 5_000 },
  btcAvailable: 14_000,
  showBtc: true,
  btcPriceUSD: 100_000,
  assets: [
    token('rgb-usdt', 'USDT', 'RGB', 30_000_000, 6, 'Tether USD'),
    token('spark-usdt', 'USDt', 'SPARK', 10_000_000, 6, 'USDT on Spark'),
    token('xaut', 'XAUT', 'RGB', 5_000_000, 6, 'Tether Gold'),
  ],
};

test('bitcoin is one row matching the dashboard, with the networks that hold it', () => {
  const [btc] = buildAssetListItems(base);
  expect(btc).toMatchObject({ key: 'BTC', amount: 14_000, networks: ['onchain', 'spark'], isBtc: true });
  // $100,000/BTC → 14,000 sats = $14.
  expect(btc.usdValue).toBeCloseTo(14);
});

test('the same token on two networks is one row with the sum', () => {
  const items = buildAssetListItems(base);
  const usdt = items.find((i) => i.ticker.toUpperCase() === 'USDT')!;
  expect(usdt.amount).toBe(40);
  expect(usdt.networks).toEqual(['rgb', 'spark']);
  expect(usdt.usdValue).toBe(40);
  expect(usdt.name).toBe('Tether USD');
  expect(dominantHolding(usdt)?.token?.asset_id).toBe('rgb-usdt');
  expect(items.find((i) => i.ticker === 'XAUT')?.usdValue).toBeUndefined();
  expect(items).toHaveLength(3);
});

test('a network filter shows only what lives there', () => {
  const items = buildAssetListItems(base);
  const spark = filterAssetItems(items, 'spark');
  expect(spark.map((i) => [i.ticker, i.amount])).toEqual([['BTC', 5_000], ['USDT', 10]]);
  expect(spark[0].usdValue).toBeCloseTo(5);
  expect(spark[1].usdValue).toBe(10);
  expect(filterAssetItems(items, 'rgb').map((i) => i.ticker)).toEqual(['USDT', 'XAUT']);
  expect(filterAssetItems(items, 'bark')).toEqual([]);
});

test('only filters that would show something are offered', () => {
  expect(availableAssetFilters(buildAssetListItems(base))).toEqual(['all', 'onchain', 'lightning', 'spark', 'rgb']);
  expect(availableAssetFilters([])).toEqual(['all']);
});

test('search matches ticker, name or an exact asset id', () => {
  const items = buildAssetListItems(base);
  expect(filterAssetItems(items, 'all', 'gold').map((i) => i.ticker)).toEqual(['XAUT']);
  expect(filterAssetItems(items, 'all', 'btc').map((i) => i.ticker)).toEqual(['BTC']);
  expect(filterAssetItems(items, 'all', 'spark-usdt').map((i) => i.ticker)).toEqual(['USDT']);
});

test('Lite folds its dollar assets into one USD row, like the dashboard', () => {
  const items = buildAssetListItems({ ...base, liteUsdAssetIds: new Set(['rgb-usdt']) });
  const usd = items.find((i) => i.key === LITE_USD_KEY)!;
  expect(usd).toMatchObject({ ticker: 'USD', amount: 30, usdValue: 30 });
  // The rest stays as it was.
  expect(items.find((i) => i.key === 'asset:USDT')?.amount).toBe(10);
});

test('the header total adds up every priced row', () => {
  expect(assetListUsdTotal(buildAssetListItems(base))).toBeCloseTo(54);
});

test('no bitcoin row before any balance is known', () => {
  expect(buildAssetListItems({ ...base, showBtc: false, assets: [] })).toEqual([]);
});

test('amounts read with separators and no trailing zeros', () => {
  const { formatTokenAmount, networkLabel } = require('./asset-list-model');
  expect(formatTokenAmount(1234.5, 6)).toBe('1,234.5');
  expect(formatTokenAmount(21000, 0)).toBe('21,000');
  expect(formatTokenAmount(0, 2)).toBe('0');
  expect(networkLabel('onchain')).toBe('Bitcoin');
});
