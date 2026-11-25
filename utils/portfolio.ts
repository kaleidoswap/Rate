/**
 * What the wallet's tokens are worth, in dollars and in sats.
 *
 * Dollar stablecoins are valued at $1 (the extension's fixed-USD policy); every
 * other token has no known price and adds nothing to the total. Amounts use the
 * same balance the asset rows show (getAssetBaseUnitBalance), so the rows and the
 * headline total always agree.
 */
import { formatAssetAmount, getAssetBaseUnitBalance, type AssetBalanceLike } from './assetAmount';
import { getAssetFamily } from './account-routing';
import { LIQUID_USDT_ASSET_ID } from '@kaleidorg/wallet-engine';
import { USDB_TOKEN_ADDRESS } from './flashnet';

const SATS_PER_BTC = 100_000_000;

export interface PricedAsset {
  asset_id?: string;
  protocol?: string | null;
  ticker?: string | null;
  name?: string | null;
  precision?: number | null;
  balance: AssetBalanceLike;
}

/** Only known mainnet assets receive a fixed USD price. Tickers are issuer-controlled. */
export function tokenUsdPrice(
  asset: Pick<PricedAsset, 'asset_id' | 'protocol'>,
  testProtocols?: ReadonlySet<string>,
): number | undefined {
  const id = asset.asset_id?.toLowerCase();
  if (!id) return undefined;
  const protocol = asset.protocol?.toUpperCase() ?? getAssetFamily(id);
  if (testProtocols?.has(protocol)) return undefined;
  if (id === LIQUID_USDT_ASSET_ID && (!asset.protocol || protocol === 'LIQUID')) return 1;
  if (protocol === 'SPARK' && id === USDB_TOKEN_ADDRESS.mainnet) return 1;
  return undefined;
}

/** Whole-token amount of an asset row (base units divided by its precision). */
export function assetDisplayAmount(asset: PricedAsset): number {
  return getAssetBaseUnitBalance(asset.balance) / Math.pow(10, asset.precision || 0);
}

/**
 * Dollar value of an asset's balance, or undefined when it has no price.
 */
export function assetUsdValue(asset: PricedAsset, testProtocols?: ReadonlySet<string>): number | undefined {
  const price = tokenUsdPrice(asset, testProtocols);
  if (price === undefined) return undefined;
  const value = assetDisplayAmount(asset) * price;
  return Number.isFinite(value) ? value : undefined;
}

export function usdToSats(usd: number, btcPriceUSD: number): number {
  if (!btcPriceUSD || btcPriceUSD <= 0 || !Number.isFinite(usd)) return 0;
  return Math.round((usd / btcPriceUSD) * SATS_PER_BTC);
}

/** Total dollar value of the priced tokens. */
export function tokenValueUsd(assets: readonly PricedAsset[], testProtocols?: ReadonlySet<string>): number {
  let usd = 0;
  for (const asset of assets) {
    if (asset.asset_id === 'BTC') continue;
    const value = assetUsdValue(asset, testProtocols);
    if (value && value > 0) usd += value;
  }
  return usd;
}

/** Priced tokens as sats, to add to the bitcoin total. 0 until a BTC price is known. */
export function tokenValueSats(
  assets: readonly PricedAsset[],
  btcPriceUSD: number,
  testProtocols?: ReadonlySet<string>,
): number {
  return usdToSats(tokenValueUsd(assets, testProtocols), btcPriceUSD);
}

/** "$1,234.50"; sub-cent values keep up to four decimals so they don't read as $0.00. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

export interface BreakdownAssetRow {
  key: string;
  ticker: string;
  name: string;
  /** NetworkIcon key ('rgb' | 'spark' | 'arkade'); absent for Lite's folded dollar row. */
  network?: string;
  /** "RGB", "Spark", "Arkade". */
  networkLabel?: string;
  /** Whole-token amount, e.g. "12.5". */
  amount: string;
  /** Dollar value, or undefined when the asset has no price. */
  usdValue?: number;
}

const NETWORK_LABEL: Record<string, string> = { RGB: 'RGB', SPARK: 'Spark', ARKADE: 'Arkade', LIQUID: 'Liquid' };

/**
 * The non-bitcoin assets for the balance breakdown, one row each: priced ones
 * first (largest value first), then the unpriced ones, which carry no fiat value
 * and stay out of the total. Empty balances are left out. In Lite, the
 * designated holding folds into one "US Dollar" row, as in the asset list.
 */
export function breakdownAssetRows(
  assets: readonly PricedAsset[],
  opts: { foldedUsdAssetIds?: ReadonlySet<string>; testProtocols?: ReadonlySet<string> } = {},
): BreakdownAssetRow[] {
  const rows: BreakdownAssetRow[] = [];
  let dollars = 0;
  let hasDollars = false;
  for (const asset of assets) {
    const id = String(asset.asset_id ?? '');
    if (!id || id === 'BTC') continue;
    const baseUnits = getAssetBaseUnitBalance(asset.balance);
    if (!(baseUnits > 0)) continue;
    const usdValue = assetUsdValue(asset, opts.testProtocols);
    if (opts.foldedUsdAssetIds?.has(id) && usdValue !== undefined) {
      dollars += usdValue;
      hasDollars = true;
      continue;
    }
    const family = asset.protocol?.toUpperCase() ?? getAssetFamily(id, asset.ticker);
    const ticker = String(asset.ticker ?? '').trim() || String(asset.name ?? '').trim() || 'Asset';
    rows.push({
      key: `${family}:${id}`,
      ticker,
      name: String(asset.name ?? '').trim() || ticker,
      network: family.toLowerCase(),
      networkLabel: NETWORK_LABEL[family] ?? family,
      amount: formatAssetAmount(baseUnits, asset.precision || 0),
      usdValue,
    });
  }
  rows.sort((a, b) => {
    if ((a.usdValue === undefined) !== (b.usdValue === undefined)) return a.usdValue === undefined ? 1 : -1;
    if (a.usdValue !== undefined && b.usdValue !== undefined && a.usdValue !== b.usdValue) return b.usdValue - a.usdValue;
    return a.ticker.localeCompare(b.ticker);
  });
  if (hasDollars) {
    rows.unshift({
      key: 'usd',
      ticker: 'USD',
      name: 'US Dollar',
      amount: dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      usdValue: dollars,
    });
  }
  return rows;
}
