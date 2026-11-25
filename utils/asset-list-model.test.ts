import {
  assetDetailForItem, assetListUsdTotal, availableAssetFilters, buildAssetListItems, dominantHolding, filterAssetItems, LITE_USD_KEY,
} from './asset-list-model';
import { LIQUID_USDT_ASSET_ID } from '@kaleidorg/wallet-engine';
import { USDB_TOKEN_ADDRESS } from './flashnet';

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

test('the same ticker on two networks keeps separate holdings and no ticker-based price', () => {
  const items = buildAssetListItems(base);
  const usdts = items.filter((i) => i.ticker.toUpperCase() === 'USDT');
  expect(usdts).toMatchObject([
    { amount: 30, networks: ['rgb'], name: 'Tether USD', assetIdLabel: 'rgb-usdt' },
    { amount: 10, networks: ['spark'], name: 'USDT on Spark', assetIdLabel: 'spark-usdt' },
  ]);
  expect(usdts.map(i => i.usdValue)).toEqual([undefined, undefined]);
  expect(dominantHolding(usdts[0])?.token?.asset_id).toBe('rgb-usdt');
  expect(items.find((i) => i.ticker === 'XAUT')?.usdValue).toBeUndefined();
  expect(items).toHaveLength(4);
});

test('a network filter shows only what lives there', () => {
  const items = buildAssetListItems(base);
  const spark = filterAssetItems(items, 'spark');
  expect(spark.map((i) => [i.ticker, i.amount])).toEqual([['BTC', 5_000], ['USDt', 10]]);
  expect(spark[0].usdValue).toBeCloseTo(5);
  expect(spark[1].usdValue).toBeUndefined();
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
  expect(filterAssetItems(items, 'all', 'spark-usdt').map((i) => i.ticker)).toEqual(['USDt']);
});

test('exact RGB contract searches open the requested holding even with the same ticker and network', () => {
  const first = token('rgb:Abc', 'USDT', 'RGB', 2_000_000);
  const second = token('rgb:aBc', 'USDT', 'RGB', 80_000_000);
  const items = buildAssetListItems({ ...base, assets: [first, second] });
  expect(filterAssetItems(items, 'rgb', 'usdt').map(item => item.amount)).toEqual([2, 80]);
  const matches = filterAssetItems(items, 'rgb', 'rgb:Abc');
  expect(matches).toHaveLength(1);
  expect(assetDetailForItem(matches[0], 'sats')).toMatchObject({ asset_id: first.asset_id, balance: 2_000_000 });
  expect(filterAssetItems(items, 'spark', 'rgb:Abc')).toEqual([]);
});

test('Lite folds its dollar assets into one USD row, like the dashboard', () => {
  const assets = [token(LIQUID_USDT_ASSET_ID, 'USDt', 'LIQUID', 30_000_000, 6, 'Liquid Tether'), ...base.assets];
  const items = buildAssetListItems({ ...base, assets, liteUsdAssetIds: new Set([LIQUID_USDT_ASSET_ID, 'rgb-usdt']) });
  const usd = items.find((i) => i.key === LITE_USD_KEY)!;
  expect(usd).toMatchObject({ ticker: 'USD', amount: 30, usdValue: 30 });
  // The rest stays as it was.
  expect(items.find((i) => i.key === 'asset:rgb:rgb-usdt')?.amount).toBe(30);
  const [exact] = filterAssetItems(items, 'all', LIQUID_USDT_ASSET_ID);
  expect(assetDetailForItem(exact, 'sats')).toMatchObject({ asset_id: LIQUID_USDT_ASSET_ID });
  expect(filterAssetItems(items, 'all', 'Liquid Tether').map(item => item.key)).toEqual([LITE_USD_KEY]);
});

test('visibility applies to the exact holding before Lite aggregation', () => {
  const assets = [token(LIQUID_USDT_ASSET_ID, 'USDt', 'LIQUID', 30_000_000), ...base.assets];
  const items = buildAssetListItems({ ...base, assets, liteUsdAssetIds: new Set([LIQUID_USDT_ASSET_ID]),
    hiddenAssetKeys: new Set([`asset:rgb:${LIQUID_USDT_ASSET_ID}`, 'asset:rgb:rgb-usdt']) });
  expect(items.map(item => item.key)).toEqual(['BTC', 'asset:spark:spark-usdt', 'asset:rgb:xaut']);
});

test('search on a selected network checks only its holdings in folded Lite USD', () => {
  const spark = USDB_TOKEN_ADDRESS.mainnet;
  const assets = [token(LIQUID_USDT_ASSET_ID, 'USDt', 'LIQUID', 30_000_000, 6, 'Liquid Tether'),
    token(spark, 'USDB', 'SPARK', 20_000_000, 6, 'Spark USD Balance')];
  const items = buildAssetListItems({ ...base, showBtc: false, assets, liteUsdAssetIds: new Set([LIQUID_USDT_ASSET_ID, spark]) });
  expect(filterAssetItems(items, 'spark', 'liquid tether')).toEqual([]);
  expect(filterAssetItems(items, 'spark', LIQUID_USDT_ASSET_ID)).toEqual([]);
  expect(filterAssetItems(items, 'spark', 'spark usd')).toMatchObject([{ amount: 20, networks: ['spark'] }]);
});

test('the header total adds up every priced row', () => {
  const assets = [...base.assets, token(USDB_TOKEN_ADDRESS.mainnet, 'USDB', 'SPARK', 20_000_000)];
  expect(assetListUsdTotal(buildAssetListItems({ ...base, assets }))).toBeCloseTo(34);
  expect(assetListUsdTotal(buildAssetListItems({ ...base, assets, testProtocols: new Set(['SPARK']) }))).toBeCloseTo(14);
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

test('network filters do not assign fiat value to test bitcoin', () => {
  const items = buildAssetListItems({ ...base, btcMainnetNetworks: { onchain: 10_000 } });
  const [sparkBtc] = filterAssetItems(items, 'spark');
  expect(sparkBtc.amount).toBe(5_000);
  expect(sparkBtc.usdValue).toBeUndefined();
  expect(filterAssetItems(items, 'onchain')[0].usdValue).toBeCloseTo(10);
});

test('asset detail uses the account of the selected holding', () => {
  const [btc, usdt] = filterAssetItems(buildAssetListItems(base), 'spark');
  expect(assetDetailForItem(btc, 'BTC')).toMatchObject({ precision: 8, unit: 'BTC', protocol: 'BTC', btcNetwork: 'spark', balance: { spendable: 5000 } });
  expect(assetDetailForItem(usdt, 'sats')).toMatchObject({
    asset_id: 'spark-usdt', isRGB: false, protocol: 'SPARK', fiatValue: undefined,
    locations: [{ label: 'Spark', amount: 10, unit: 'USDt' }],
  });
});
