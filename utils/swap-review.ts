import type { SwapQuote } from '../store/slices/swapSlice';
import { bech32m, hex } from '@scure/base';
import { BTC_ASSET_PUBKEY, USDB_TOKEN_ADDRESS } from './flashnet';
import { tokenUsdPrice } from './portfolio';
import { isBtcTicker } from './swap-model';

const USDB_ASSET_HEX = hex.encode(bech32m.decodeToBytes(USDB_TOKEN_ADDRESS.mainnet).bytes);

/** Integer minimum shared by the review and the submitted swap. */
export function minimumSwapOutput(rawOutput: number, slippageBps: number): number {
  if (!Number.isSafeInteger(rawOutput) || rawOutput <= 0 ||
      !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) {
    throw new Error('A valid output quote is required before swapping.');
  }
  return Math.max(1, Number(BigInt(rawOutput) * BigInt(10000 - slippageBps) / 10000n));
}

export function quoteHasExpired(expiry: number, now = Date.now()): boolean {
  return !Number.isFinite(expiry) || expiry <= now;
}
/** The portfolio's pricing policy, applied to the exact asset and chain in a swap. */
export function swapOutputUsdValue(quote: SwapQuote, unit: string, btcUsdRate: number | undefined, chain: string | undefined): number | undefined {
  if (chain !== 'mainnet' || !Number.isFinite(quote.to_amount) || quote.to_amount <= 0) return undefined;
  const btcId = quote.venue === 'flashnet' ? BTC_ASSET_PUBKEY : 'btc';
  if (isBtcTicker(quote.to_asset)) {
    if (quote.to_asset_id?.toLowerCase() !== btcId || !btcUsdRate || !Number.isFinite(btcUsdRate) || btcUsdRate <= 0) return undefined;
    return quote.to_amount * btcUsdRate / (unit === 'sats' ? 100_000_000 : 1);
  }
  const protocol = quote.venue === 'flashnet' ? 'SPARK' : 'RGB';
  // Flashnet quotes retain the raw pool identifier for submission. Normalize the
  // known token's bytes, without trusting market metadata or an issuer's ticker.
  const rawAssetId = quote.to_asset_id?.toLowerCase();
  const assetId = protocol === 'SPARK' && rawAssetId === USDB_ASSET_HEX ? USDB_TOKEN_ADDRESS.mainnet : rawAssetId;
  const price = tokenUsdPrice({ asset_id: assetId, protocol });
  return price === undefined ? undefined : quote.to_amount * price;
}
