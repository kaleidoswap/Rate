/**
 * Swap Model — core swap logic ported from rate-extension.
 * Pure functions for pair management, venue detection, amount conversion, and HTLC capacity.
 */

// ========================================================================
// Types
// ========================================================================

export interface SwapPairAsset {
  ticker: string
  name: string
  icon?: string
  protocol?: 'SPARK' | 'RGB' | 'ARKADE'
  precision: number
  protocol_ids: Record<string, string>
  endpoints?: Array<{ layer: string; min_amount: number; max_amount: number; is_active: boolean }>
}

export interface SwapPair {
  id?: string
  base: SwapPairAsset
  quote: SwapPairAsset
  routes: Array<{ from_layer: string; to_layer: string }>
  is_active?: boolean
  venue?: 'kaleidoswap' | 'flashnet'
  poolId?: string
}

export interface SwapQuoteView {
  rfq_id: string
  from_asset: SwapQuoteAsset
  to_asset: SwapQuoteAsset
  price: number
  fee: { final_fee: number; fee_asset_precision: number }
  timestamp: number
  expires_at: number
  protocolData?: { engine?: 'maker' | 'flashnet'; poolId?: string }
}

export interface SwapQuoteAsset {
  asset_id: string
  name?: string
  ticker: string
  layer?: string
  amount: number
  precision: number
}

export interface SwapChannel {
  channel_id: string
  ready?: boolean
  is_usable?: boolean
  asset_id?: string
  outbound_balance_msat?: number
  inbound_balance_msat?: number
  next_outbound_htlc_limit_msat?: number
  next_outbound_htlc_minimum_msat?: number
  max_htlc_msat?: number
  max_htlc?: number
}

export type SwapStep = 'input' | 'review' | 'processing' | 'success' | 'failed'
export type SwapProgress = 'idle' | 'init' | 'taker' | 'execute' | 'done'
export type SwapVenueFilter = 'all' | 'kaleidoswap' | 'flashnet'

// ========================================================================
// Constants
// ========================================================================

export const MSATS_PER_SAT = 1000
export const QUOTE_REFRESH_MS = 12_000
export const QUOTE_MAX_AGE_MS = 30_000
export const QUOTE_DEBOUNCE_MS = 500
export const DEFAULT_FROM_TICKER = 'BTC'
export const DEFAULT_TO_TICKER = 'USDT'
export const DEFAULT_FLASHNET_SLIPPAGE_BPS = 500

// ========================================================================
// Venue detection
// ========================================================================

export function isFlashnetPair(pair: SwapPair | null): boolean {
  return pair?.venue === 'flashnet'
}

export function isFlashnetQuote(quote: SwapQuoteView | null): boolean {
  return quote?.protocolData?.engine === 'flashnet'
}

// ========================================================================
// Pair & ticker lookups
// ========================================================================

export function allTickers(pairs: SwapPair[]): string[] {
  const tickers = new Set<string>()
  for (const pair of pairs) {
    tickers.add(pair.base.ticker)
    tickers.add(pair.quote.ticker)
  }
  return Array.from(tickers).sort()
}

export function tradableTickers(pairs: SwapPair[], withTicker: string): string[] {
  const tickers = new Set<string>()
  for (const pair of pairs) {
    if (pair.base.ticker === withTicker) tickers.add(pair.quote.ticker)
    if (pair.quote.ticker === withTicker) tickers.add(pair.base.ticker)
  }
  return Array.from(tickers).sort()
}

export function findPair(pairs: SwapPair[], fromTicker: string, toTicker: string): SwapPair | null {
  return pairs.find(
    p => (p.base.ticker === fromTicker && p.quote.ticker === toTicker)
      || (p.base.ticker === toTicker && p.quote.ticker === fromTicker)
  ) ?? null
}

export function findPairAsset(pairs: SwapPair[], ticker: string): SwapPairAsset | null {
  for (const pair of pairs) {
    if (pair.base.ticker === ticker) return pair.base
    if (pair.quote.ticker === ticker) return pair.quote
  }
  return null
}

export function getPairAsset(pair: SwapPair, ticker: string): SwapPairAsset | null {
  if (pair.base.ticker === ticker) return pair.base
  if (pair.quote.ticker === ticker) return pair.quote
  return null
}

export function getAssetId(asset: SwapPairAsset): string {
  return asset.protocol_ids.SPARK || asset.protocol_ids.ARKADE || asset.protocol_ids.RGB || asset.protocol_ids.BTC || asset.ticker
}

export function isBtcTicker(ticker: string): boolean {
  return ticker.toUpperCase() === 'BTC'
}

export function bestLayer(assetId: string): string {
  return assetId.toLowerCase() === 'btc' ? 'BTC_LN' : 'RGB_LN'
}

export function getQuoteLayers(pair: SwapPair, fromAssetId: string, toAssetId: string): { fromLayer: string; toLayer: string } {
  const defaultFrom = bestLayer(fromAssetId)
  const defaultTo = bestLayer(toAssetId)
  if (!pair.routes || pair.routes.length === 0) return { fromLayer: defaultFrom, toLayer: defaultTo }
  const exact = pair.routes.find(r => r.from_layer === defaultFrom && r.to_layer === defaultTo)
  if (exact) return { fromLayer: exact.from_layer, toLayer: exact.to_layer }
  return { fromLayer: defaultFrom, toLayer: defaultTo }
}

export function getAssetNetwork(pairs: SwapPair[], ticker: string): 'Spark' | 'LN' | 'RGB-LN' {
  const matchingPairs = pairs.filter(p => p.base.ticker === ticker || p.quote.ticker === ticker)
  if (matchingPairs.length > 0 && matchingPairs.every(p => p.venue === 'flashnet')) return 'Spark'
  return isBtcTicker(ticker) ? 'LN' : 'RGB-LN'
}

// ========================================================================
// Amount conversion
// ========================================================================

export function parseInputToApiAmount(input: string, precision: number, isBtc: boolean, btcRawUnit: 'msat' | 'sat' = 'msat'): number {
  const clean = input.replace(/[^\d.]/g, '')
  if (!clean || clean === '.') return 0
  const num = parseFloat(clean) || 0
  if (isBtc) {
    const sats = Math.round(num * 1e8)
    return btcRawUnit === 'msat' ? sats * MSATS_PER_SAT : sats
  }
  return Math.round(num * Math.pow(10, precision))
}

export function formatApiAmount(raw: number, precision: number, isBtc: boolean, btcRawUnit: 'msat' | 'sat' = 'msat'): string {
  if (isBtc) {
    const sats = btcRawUnit === 'msat' ? Math.round(raw / MSATS_PER_SAT) : Math.round(raw)
    return (sats / 1e8).toFixed(8)
  }
  if (precision <= 0) return String(raw)
  return (raw / Math.pow(10, precision)).toFixed(precision)
}

// ========================================================================
// HTLC capacity
// ========================================================================

export function getChannelMaxHtlcMsat(channel: SwapChannel): number {
  const msatValue = channel.next_outbound_htlc_limit_msat ?? channel.max_htlc_msat
  if (typeof msatValue === 'number' && Number.isFinite(msatValue) && msatValue > 0) return msatValue
  if (typeof channel.max_htlc === 'number' && Number.isFinite(channel.max_htlc) && channel.max_htlc > 0) {
    return Math.floor(channel.max_htlc) * MSATS_PER_SAT
  }
  return 0
}

export function calculateMaxOutboundHtlcMsat(channels: SwapChannel[], rgbHtlcMinSat: number): number {
  const tradableChannels = channels.filter(ch => ch.ready && (ch.next_outbound_htlc_minimum_msat ?? 0) > 0)
  const htlcLimits = tradableChannels.map(ch => getChannelMaxHtlcMsat(ch))
  if (htlcLimits.length === 0 || Math.max(...htlcLimits) <= 0) return 0
  return Math.max(0, Math.max(...htlcLimits) - rgbHtlcMinSat * MSATS_PER_SAT)
}

// ========================================================================
// Quote validation
// ========================================================================

export function isQuoteValid(quote: SwapQuoteView | null): boolean {
  if (!quote) return false
  const now = Date.now()
  if (now >= quote.expires_at * 1000) return false
  if (now - quote.timestamp * 1000 > QUOTE_MAX_AGE_MS) return false
  return true
}

export function formatQuoteFee(quote: SwapQuoteView): string {
  const precision = quote.fee.fee_asset_precision
  if (precision === 0) return `${quote.fee.final_fee} ${quote.to_asset.ticker}`
  const display = quote.fee.final_fee / Math.pow(10, precision)
  return `${display.toFixed(precision)} ${quote.to_asset.ticker}`
}

// ========================================================================
// Swap string validation
// ========================================================================

export function validateSwapString(
  swapstring: string, fromAmount: number, fromAssetId: string,
  toAmount: number, toAssetId: string, paymentHash: string,
): boolean {
  const parts = swapstring.split('/')
  if (parts.length !== 6) return false
  const [swapFromAmount, swapFromAsset, swapToAmount, swapToAsset, , swapPaymentHash] = parts
  const normalizeAsset = (v: string) => (v.toLowerCase() === 'btc' ? 'btc' : v)
  return (
    parseInt(swapFromAmount, 10) === fromAmount &&
    normalizeAsset(swapFromAsset) === normalizeAsset(fromAssetId) &&
    parseInt(swapToAmount, 10) === toAmount &&
    normalizeAsset(swapToAsset) === normalizeAsset(toAssetId) &&
    swapPaymentHash === paymentHash
  )
}

// ========================================================================
// Pair normalization (for loading trading pairs from different venues)
// ========================================================================

export function normalizeMakerPairs(rawPairs: any[]): SwapPair[] {
  return (rawPairs || []).filter((p: any) => p.is_active !== false).map((p: any) => ({
    id: p.id,
    base: {
      ticker: p.base_asset || p.baseAsset || '',
      name: p.base_asset_name || p.baseAssetName || p.base_asset || '',
      precision: p.base_precision || p.basePrecision || 8,
      protocol_ids: { RGB: p.base_asset_id || p.baseAssetId || '' },
      endpoints: p.endpoints,
    },
    quote: {
      ticker: p.quote_asset || p.quoteAsset || '',
      name: p.quote_asset_name || p.quoteAssetName || p.quote_asset || '',
      precision: p.quote_precision || p.quotePrecision || 8,
      protocol_ids: { RGB: p.quote_asset_id || p.quoteAssetId || '' },
      endpoints: p.endpoints,
    },
    routes: p.routes || [{ from_layer: 'RGB_LN', to_layer: 'RGB_LN' }],
    is_active: p.is_active ?? true,
    venue: 'kaleidoswap' as const,
  }))
}

export function buildFlashnetPairs(pools: any[]): SwapPair[] {
  return (pools || []).map((pool: any) => {
    const btcAsset: SwapPairAsset = {
      ticker: 'BTC',
      name: 'Bitcoin on Spark',
      protocol: 'SPARK',
      precision: 8,
      protocol_ids: { SPARK: pool.assetAAddress || pool.lpPublicKey || '' },
    }

    const tokenTicker = pool.tokenTicker || pool.assetBTicker || 'USDB'
    const tokenAsset: SwapPairAsset = {
      ticker: tokenTicker,
      name: pool.tokenName || tokenTicker,
      protocol: 'SPARK',
      precision: pool.tokenPrecision ?? 6,
      protocol_ids: { SPARK: pool.assetBAddress || '' },
    }

    return {
      id: `flashnet-${pool.lpPublicKey || ''}`,
      base: btcAsset,
      quote: tokenAsset,
      routes: [],
      is_active: true,
      venue: 'flashnet' as const,
      poolId: pool.lpPublicKey,
    }
  })
}
