/**
 * What the wallet's tokens are worth, in dollars and in sats.
 *
 * Dollar stablecoins are valued at $1 (the extension's fixed-USD policy); every
 * other token has no known price and adds nothing to the total. Amounts use the
 * same balance the asset rows show (getAssetBaseUnitBalance), so the rows and the
 * headline total always agree.
 */
import { getAssetBaseUnitBalance, type AssetBalanceLike } from './assetAmount';

const SATS_PER_BTC = 100_000_000;

export const USD_STABLECOIN_TICKERS: ReadonlySet<string> = new Set(['USDT', 'USDC', 'USDB', 'DAI', 'BUSD', 'USD']);

export interface PricedAsset {
  asset_id?: string;
  ticker?: string | null;
  precision?: number | null;
  balance: AssetBalanceLike;
}

/** USD price of one whole token, or null when there is none. */
export function tokenUsdPrice(ticker?: string | null): number | null {
  return USD_STABLECOIN_TICKERS.has(String(ticker ?? '').trim().toUpperCase()) ? 1 : null;
}

/** Whole-token amount of an asset row (base units divided by its precision). */
export function assetDisplayAmount(asset: PricedAsset): number {
  return getAssetBaseUnitBalance(asset.balance) / Math.pow(10, asset.precision || 0);
}

/**
 * Dollar value of an asset's balance, or undefined when it has no price.
 * `usdAssetIds` marks assets known to be dollars whatever their ticker says.
 */
export function assetUsdValue(asset: PricedAsset, usdAssetIds?: ReadonlySet<string>): number | undefined {
  const price = asset.asset_id && usdAssetIds?.has(asset.asset_id) ? 1 : tokenUsdPrice(asset.ticker);
  if (price == null) return undefined;
  const value = assetDisplayAmount(asset) * price;
  return Number.isFinite(value) ? value : undefined;
}

export function usdToSats(usd: number, btcPriceUSD: number): number {
  if (!btcPriceUSD || btcPriceUSD <= 0 || !Number.isFinite(usd)) return 0;
  return Math.round((usd / btcPriceUSD) * SATS_PER_BTC);
}

/** Total dollar value of the priced tokens. */
export function tokenValueUsd(assets: readonly PricedAsset[], usdAssetIds?: ReadonlySet<string>): number {
  let usd = 0;
  for (const asset of assets) {
    if (asset.asset_id === 'BTC') continue;
    const value = assetUsdValue(asset, usdAssetIds);
    if (value && value > 0) usd += value;
  }
  return usd;
}

/** Priced tokens as sats, to add to the bitcoin total. 0 until a BTC price is known. */
export function tokenValueSats(
  assets: readonly PricedAsset[],
  btcPriceUSD: number,
  usdAssetIds?: ReadonlySet<string>,
): number {
  return usdToSats(tokenValueUsd(assets, usdAssetIds), btcPriceUSD);
}

/** "$1,234.50"; sub-cent values keep up to four decimals so they don't read as $0.00. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}
