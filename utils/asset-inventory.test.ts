import {
  assetRecordFromUnified, btcInputFromWallet, buildAssetInventory, inventoryBtc, inventoryTokens,
  liteUsdAssetIds, replaceProtocolAssets, selectAssetInventory, withSnapshotFallback, type InventoryRecord,
} from './asset-inventory';
import { USDB_DECIMALS, USDB_TICKER, USDB_TOKEN_ADDRESS } from './flashnet';

const LIQUID_USDT = 'ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2';

const record = (asset_id: string, ticker: string, protocol: string | undefined, balance: InventoryRecord['balance'], extra: Partial<InventoryRecord> = {}): InventoryRecord =>
  ({ asset_id, ticker, name: ticker, precision: 6, protocol, balance, ...extra });

describe('assetRecordFromUnified', () => {
  it('keeps the account, the icon and the full breakdown; the row shows what is spendable', () => {
    const r = assetRecordFromUnified({
      id: 'rgb:usdt', ticker: 'USDT', name: 'Tether', precision: 6, icon: 'u.png', metadata: { issued_supply: 9 },
      balance: { total: 50, pending: 60, available: 40, offchain_outbound: 10, offchain_inbound: 3 },
    }, 'RGB');
    expect(r).toMatchObject({
      asset_id: 'rgb:usdt', ticker: 'USDT', protocol: 'RGB', icon: 'u.png', issued_supply: 9, balance: 40,
      balanceDetail: { settled: 50, future: 60, spendable: 40, offchain_outbound: 10, offchain_inbound: 3 },
    });
  });

  it('skips bitcoin and pins USDB to its canonical metadata', () => {
    expect(assetRecordFromUnified({ id: 'BTC', balance: {} }, 'SPARK')).toBeNull();
    const usdb = assetRecordFromUnified({
      id: USDB_TOKEN_ADDRESS.mainnet,
      ticker: 'RAW', name: 'raw', precision: 0, balance: { available: 1 },
    }, 'SPARK');
    expect(usdb?.ticker).toBe(USDB_TICKER);
    expect(usdb?.precision).toBe(USDB_DECIMALS);
  });

  it('treats a missing balance as zero and an asset in a channel only as locked', () => {
    const r = assetRecordFromUnified({ id: 'rgb:x', ticker: 'X', name: 'X', precision: 0, balance: { locked: 7 } }, 'RGB');
    expect(r?.balance).toBe(0);
    expect(r?.balanceDetail?.offchain_outbound).toBe(7);
  });
});

describe('buildAssetInventory', () => {
  it('lists bitcoin once, first, then every account with its protocol', () => {
    const inventory = buildAssetInventory({
      btc: { available: 14_000, networks: { onchain: 10_000, spark: 4_000 } },
      assets: [
        record('rgb:usdt', 'USDT', 'RGB', 30),
        record('btkn1usdt', 'USDT', 'SPARK', 10),
        record('BTC', 'BTC', 'SPARK', 999),
      ],
    });
    expect(inventory.map((a) => [a.asset_id, a.protocol, a.isNativeBtc])).toEqual([
      ['BTC', 'BTC', true], ['rgb:usdt', 'RGB', false], ['btkn1usdt', 'SPARK', false],
    ]);
    expect(inventoryBtc(inventory)).toMatchObject({ balance: 14_000, precision: 8, networks: { onchain: 10_000, spark: 4_000 } });
    expect(inventoryTokens(inventory)).toHaveLength(2);
  });

  it('shows bitcoin at zero before any balance is known', () => {
    expect(buildAssetInventory({ btc: null, assets: null })).toEqual([
      expect.objectContaining({ asset_id: 'BTC', balance: 0, isNativeBtc: true }),
    ]);
    expect(inventoryBtc([]).balance).toBe(0);
  });

  it('reads both record shapes: a number with a breakdown, or the breakdown itself', () => {
    const [, newer, older] = buildAssetInventory({
      btc: null,
      assets: [
        record('rgb:a', 'A', 'RGB', 5, { balanceDetail: { spendable: 5, settled: 8 } }),
        record('rgb:b', 'B', 'RGB', { settled: 9, spendable: 7 } as any),
      ],
    });
    expect(newer).toMatchObject({ balance: 5, balanceDetail: { settled: 8 } });
    expect(older).toMatchObject({ balance: 7, balanceDetail: { settled: 9, spendable: 7 } });
  });

  it('names the account of records saved without one, and drops duplicates', () => {
    const inventory = buildAssetInventory({
      btc: null,
      assets: [
        record('btkn1tok', 'TOK', undefined, 1),
        record('rgb:z', 'Z', 'RGB_L1', 1),
        record('ark1asset', 'ARKX', null as any, 1),
        record('rgb:z', 'Z', 'RGB', 2),
        record('', 'EMPTY', 'RGB', 1),
      ],
    });
    expect(inventoryTokens(inventory).map((a) => `${a.protocol}:${a.asset_id}:${a.balance}`)).toEqual([
      'SPARK:btkn1tok:1', 'RGB:rgb:z:1', 'ARKADE:ark1asset:1',
    ]);
  });
});

describe('replaceProtocolAssets', () => {
  it('replaces one account and keeps the others', () => {
    const current = [record('rgb:a', 'A', 'RGB', 1), record('btkn1b', 'B', 'SPARK', 1), record('rgb:old', 'O', undefined, 1)];
    const next = replaceProtocolAssets(current, 'RGB', [record('rgb:old', 'O', 'RGB', 3)]);
    expect(next.map((a) => `${a.protocol}:${a.asset_id}:${a.balance}`)).toEqual(['SPARK:btkn1b:1', 'RGB:rgb:old:3']);
  });

  it('an account that now lists nothing shows nothing', () => {
    expect(replaceProtocolAssets([record('rgb:a', 'A', 'RGB', 1)], 'RGB', [])).toEqual([]);
  });
});

describe('withSnapshotFallback', () => {
  it('keeps last known assets only for accounts that have not answered yet', () => {
    const snapshot = [record('rgb:a', 'A', 'RGB', 1), record('btkn1b', 'B', 'SPARK', 1)];
    const live = [record('rgb:a', 'A', 'RGB', 5)];
    expect(withSnapshotFallback(live, snapshot).map((a) => `${a.asset_id}:${a.balance}`)).toEqual(['btkn1b:1', 'rgb:a:5']);
    expect(withSnapshotFallback([], snapshot)).toHaveLength(2);
  });
});

describe('liteUsdAssetIds', () => {
  it('picks the Lite dollar asset by id, never by ticker', () => {
    expect(Array.from(liteUsdAssetIds([{ asset_id: LIQUID_USDT }, { asset_id: 'rgb:fake-usd' }]))).toEqual([LIQUID_USDT]);
  });
});

describe('the redux selector', () => {
  const state = (btcBalance: any, rgbAssets: InventoryRecord[]) => ({ wallet: { btcBalance }, assets: { rgbAssets } });

  it('uses the dashboard bitcoin figure, or the spendable sum before it exists', () => {
    expect(btcInputFromWallet(null)).toBeNull();
    expect(btcInputFromWallet({ vanilla: { spendable: 7 }, colored: { spendable: 1 } })?.available).toBe(8);
    expect(btcInputFromWallet({ vanilla: { spendable: 7 }, summary: { available: 3 }, networks: { spark: 3 } }))
      .toEqual({ available: 3, spendable: 7, networks: { spark: 3 } });
  });

  it('keeps test-network bitcoin spendable for Swap and Receive while the total stays mainnet', () => {
    const [btc] = buildAssetInventory({ btc: btcInputFromWallet({ vanilla: { spendable: 5000 }, summary: { available: 0 } }), assets: [] });
    expect(btc.balance).toBe(0);
    expect(btc.spendable).toBe(5000);
  });

  it('returns the same list until the balances or the assets change', () => {
    const assets = [record('rgb:a', 'A', 'RGB', 1)];
    const btc = { vanilla: { spendable: 1 }, summary: { available: 1 } };
    const first = selectAssetInventory(state(btc, assets));
    expect(selectAssetInventory(state(btc, assets))).toBe(first);
    expect(selectAssetInventory(state(btc, [...assets]))).not.toBe(first);
    expect(first.map((a) => a.asset_id)).toEqual(['BTC', 'rgb:a']);
  });
});
