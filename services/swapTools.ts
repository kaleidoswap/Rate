// Mobile binding for the canonical @kaleidorg/mind KaleidoSwap contract,
// venue-aware: the same kaleidoswap_* tools transparently quote + execute on
// EITHER venue, picked by the pair —
//   - KaleidoSwap maker (RGB Lightning node)  → atomic HTLC swap
//   - Flashnet (Spark DEX pool)               → single-step AMM swap
// All ON-DEVICE — no MCP. The two venues use disjoint asset
// tickers (RGB USDT/XAUT vs Spark USDB), so the ticker selects the venue.
//
// Execution replicates rate's tested SwapScreen flows verbatim:
//   - maker:    get_quote → initSwap → validateSwapString → whitelist → execute
//   - flashnet: simulateSwap → executeSwap (minAmountOut floored at 95%)
// The execute path is the canonical `execute_swap { quote_id }` from the wallet
// contract — a spend, so confirmation-gated — run against the cached quote of
// whichever venue produced it. Status comes from `kaleidoswap_atomic_status`.
//
// `kaleidoswap_atomic_init` / `_execute` are intentionally NOT bound: their
// invoice-based shape doesn't match either on-device flow, so `execute_swap`
// runs the whole tested sequence behind one confirmation.

import { InProcessToolSource, getWalletTool, type ToolSource } from '@kaleidorg/mind';
import { kaleidoswapTools, normalizeKaleidoswapArgs } from '@kaleidorg/mind/kaleidoswap';
import { protocolManager, kaleidoClientManager, flashnetClientManager } from './protocols';
import {
  normalizeMakerPairs,
  buildFlashnetPairs,
  findPair,
  getPairAsset,
  getAssetId,
  isBtcTicker,
  isFlashnetPair,
  getQuoteLayers,
  validateSwapString,
  swapChannelShortfall,
  MSATS_PER_SAT,
  DEFAULT_FLASHNET_SLIPPAGE_BPS,
  type SwapPair,
} from '../utils/swap-model';
import { BTC_ASSET_PUBKEY } from '../utils/flashnet';
import { loadChannelLiquidity } from './swapQuotes';

const log = (...a: any[]) => { try { console.log('[AI/swap]', ...a); } catch { /* noop */ } };

type Venue = 'kaleidoswap' | 'flashnet';

/** Quotes are short-lived; cache the exact integers the venue quoted so
 *  execute_swap re-uses them verbatim (re-deriving from a rounded display amount
 *  breaks maker swapstring validation + Flashnet min-out). */
const QUOTE_TTL_MS = 60_000;
interface CachedQuote {
  venue: Venue;
  fromAssetId: string;
  toAssetId: string;
  rawFromAmount: number;
  rawToAmount: number;
  poolId?: string;
  ts: number;
  fromTicker: string;
  toTicker: string;
  sendAmount: number;
  receiveAmount: number;
  receiveUnit: string;
  /** The venue's own quote id when it differs from the cache key (after a re-quote). */
  rfqId?: string;
  fee?: number;
  feeUnit?: string;
  fromLayer?: string;
  toLayer?: string;
  /** Venue expiry, ms since epoch. */
  expiresAt: number;
}
const quoteCache = new Map<string, CachedQuote>();

export interface SwapQuoteView {
  quoteId: string;
  venue: Venue;
  from: string;
  to: string;
  sendAmount: number;
  receiveAmount: number;
  receiveUnit: string;
  fee?: number;
  feeUnit?: string;
  fromLayer?: string;
  toLayer?: string;
  expiresAt: number;
}

function toView(quoteId: string, q: CachedQuote): SwapQuoteView {
  return {
    quoteId, venue: q.venue, from: q.fromTicker, to: q.toTicker,
    sendAmount: q.sendAmount, receiveAmount: q.receiveAmount, receiveUnit: q.receiveUnit,
    fee: q.fee, feeUnit: q.feeUnit, fromLayer: q.fromLayer, toLayer: q.toLayer,
    expiresAt: Math.min(q.expiresAt, q.ts + QUOTE_TTL_MS),
  };
}

/** What a cached quote swaps, for the confirmation sheet (execute_swap only carries quote_id). */
export function describeSwapQuote(quoteId: string): SwapQuoteView | null {
  const q = quoteCache.get(quoteId);
  return q ? toView(quoteId, q) : null;
}

/** Re-quote when less than this is left before expiry; a model step can take longer. */
export const REQUOTE_MARGIN_MS = 20_000;
/** Largest drop in the received amount accepted without asking the user again. */
export const PRICE_TOLERANCE = 0.01;

export function quoteNeedsRefresh(q: Pick<SwapQuoteView, 'expiresAt'>, now = Date.now(), marginMs = REQUOTE_MARGIN_MS): boolean {
  return q.expiresAt - now < marginMs;
}

/** Fractional drop in what the user receives (positive = worse for the user). */
export function priceMove(previousReceive: number, nextReceive: number): number {
  if (!(previousReceive > 0)) return 0;
  return (previousReceive - nextReceive) / previousReceive;
}

export interface SwapConfirmCheck {
  quote: SwapQuoteView;
  refreshed: boolean;
  /** Drop vs `shownReceive` (fraction). */
  move: number;
  /** The new terms are worse than the tolerance: show them and ask again. */
  needsReapproval: boolean;
}

/**
 * Called by the confirm sheet: keeps the quote behind `quoteId` fresh enough to
 * survive until execution. A stale quote is replaced (same cache key, new venue
 * terms) and compared with the amount the user was shown.
 */
export async function refreshSwapQuoteForConfirm(
  quoteId: string,
  shownReceive?: number,
  opts: { now?: number; marginMs?: number; tolerance?: number } = {},
): Promise<SwapConfirmCheck> {
  const q = quoteCache.get(quoteId);
  if (!q) throw new Error('That quote is no longer available — please get a fresh quote first.');
  const now = opts.now ?? Date.now();
  const tolerance = opts.tolerance ?? PRICE_TOLERANCE;
  const reference = shownReceive ?? q.receiveAmount;
  const current = toView(quoteId, q);
  if (!quoteNeedsRefresh(current, now, opts.marginMs)) {
    const move = priceMove(reference, q.receiveAmount);
    return { quote: current, refreshed: false, move, needsReapproval: move > tolerance };
  }
  const { id: venueId, quote: next } = await fetchQuote(q.fromTicker, q.toTicker, q.sendAmount);
  quoteCache.set(quoteId, { ...next, rfqId: next.venue === 'kaleidoswap' ? venueId : undefined });
  const view = toView(quoteId, quoteCache.get(quoteId)!);
  const move = priceMove(reference, view.receiveAmount);
  log('re-quoted for confirm', { quoteId, venueId, move });
  return { quote: view, refreshed: true, move, needsReapproval: move > tolerance };
}

function makerFee(resp: any, fromTicker: string, toTicker: string, fromAssetId: string): { fee?: number; feeUnit?: string } {
  const raw = Number(resp?.fee?.final_fee);
  if (!Number.isFinite(raw)) return {};
  const precision = Number(resp?.fee?.fee_asset_precision ?? 0);
  const asset = String(resp?.fee?.fee_asset ?? '');
  const display = raw / Math.pow(10, Number.isFinite(precision) ? precision : 0);
  if (isBtcTicker(asset)) return { fee: Math.round(display * 1e8), feeUnit: 'sats' };
  return { fee: display, feeUnit: asset === fromAssetId ? fromTicker : toTicker };
}

/** Quote `amt` (display units) of `from` → `to` on whichever venue lists the pair. */
async function fetchQuote(from: string, to: string, amt: number): Promise<{ id: string; quote: CachedQuote; price?: unknown }> {
  const pairs = await loadAllPairs();
  const pair = findPair(pairs, from, to);
  if (!pair) throw new Error(`No swap pair for ${from}/${to} on a connected venue.`);
  const fromA = getPairAsset(pair, from);
  const toA = getPairAsset(pair, to);
  if (!fromA || !toA) throw new Error(`Couldn't resolve the assets for ${from}/${to}.`);
  const fromAssetId = getAssetId(fromA);
  const toAssetId = getAssetId(toA);
  const now = Date.now();

  // Flashnet (Spark AMM): BTC settles in sats; assets in raw smallest units.
  if (isFlashnetPair(pair)) {
    const client = flashnet();
    const poolId = pair.poolId || flashnetClientManager.getPoolId() || undefined;
    const rawFromAmount = isBtcTicker(from) ? Math.round(amt) : Math.round(amt * Math.pow(10, fromA.precision));
    const sim: any = await client.simulateSwap({
      poolId,
      assetInAddress: fromAssetId,
      assetOutAddress: toAssetId,
      amountIn: String(rawFromAmount),
      maxSlippageBps: DEFAULT_FLASHNET_SLIPPAGE_BPS,
    });
    const rawToAmount = Number(sim?.amountOut ?? sim?.amount_out ?? 0);
    const rawFee = Number(sim?.feePaidAssetIn ?? sim?.fee_paid_asset_in ?? 0);
    const id = `flashnet-${now}`;
    log('flashnet quote', { id, from, to, amt, rawToAmount });
    return {
      id,
      price: sim?.executionPrice,
      quote: {
        venue: 'flashnet', fromAssetId, toAssetId, rawFromAmount, rawToAmount, poolId, ts: now,
        fromTicker: from, toTicker: to, sendAmount: amt,
        receiveAmount: isBtcTicker(to) ? rawToAmount : rawToAmount / Math.pow(10, toA.precision),
        receiveUnit: isBtcTicker(to) ? 'sats' : to,
        fee: isBtcTicker(from) ? rawFee : rawFee / Math.pow(10, fromA.precision),
        feeUnit: isBtcTicker(from) ? 'sats' : from,
        fromLayer: 'Spark', toLayer: 'Spark',
        expiresAt: now + 30_000,
      },
    };
  }

  // KaleidoSwap maker (RGB/RLN): BTC quoted in msats.
  const rawFromAmount = isBtcTicker(from) ? Math.round(amt * MSATS_PER_SAT) : Math.round(amt * Math.pow(10, fromA.precision));
  const { fromLayer, toLayer } = getQuoteLayers(pair, fromAssetId, toAssetId);
  const resp: any = await maker().getQuote({
    from_asset: { asset_id: fromAssetId, layer: fromLayer, amount: rawFromAmount },
    to_asset: { asset_id: toAssetId, layer: toLayer },
  });
  const rfqId = resp?.rfq_id;
  if (!rfqId) throw new Error('The maker did not return a quote — try again.');
  const rawToAmount = Number(resp?.to_asset?.amount ?? 0);
  const rawFromQuoted = Number(resp?.from_asset?.amount ?? rawFromAmount);
  const expiresSec = Number(resp?.expires_at);
  const quote: CachedQuote = {
    venue: 'kaleidoswap', fromAssetId, toAssetId, rawFromAmount: rawFromQuoted, rawToAmount, ts: now,
    fromTicker: from, toTicker: to, sendAmount: amt,
    receiveAmount: isBtcTicker(to) ? rawToAmount / MSATS_PER_SAT : rawToAmount / Math.pow(10, toA.precision),
    receiveUnit: isBtcTicker(to) ? 'sats' : to,
    ...makerFee(resp, from, to, fromAssetId),
    fromLayer: String(fromLayer ?? ''), toLayer: String(toLayer ?? ''),
    expiresAt: Number.isFinite(expiresSec) && expiresSec > 0 ? expiresSec * 1000 : now + QUOTE_TTL_MS,
  };
  await assertChannelCapacity(quote);
  log('maker quote', { rfqId, from, to, amt, rawToAmount });
  return { id: rfqId, quote, price: resp?.price };
}

/** A read-only quote for a preview card (BTC amounts in sats). Nothing is cached or executed. */
export async function previewSwapQuote(from: string, to: string, amount: number): Promise<{ receiveAmount: number; receiveUnit: string; fee?: number; feeUnit?: string; venue: string }> {
  requireSwaps();
  const { quote } = await fetchQuote(from.toUpperCase(), to.toUpperCase(), amount);
  return {
    receiveAmount: quote.receiveAmount,
    receiveUnit: quote.receiveUnit,
    fee: quote.fee,
    feeUnit: quote.feeUnit,
    venue: quote.venue === 'flashnet' ? 'Flashnet' : 'KaleidoSwap',
  };
}

/** Throws when the node's channels can't carry this maker swap, before anything is locked. */
async function assertChannelCapacity(q: CachedQuote): Promise<void> {
  const { channels, htlcMinMsat } = await loadChannelLiquidity();
  const leg = (assetId: string, ticker: string, raw: number, amount: number) => ({ assetId, ticker, raw, label: `${amount} ${ticker}` });
  const shortfall = swapChannelShortfall(
    leg(q.fromAssetId, q.fromTicker, q.rawFromAmount, q.sendAmount),
    leg(q.toAssetId, q.toTicker, q.rawToAmount, q.receiveAmount),
    channels,
    htlcMinMsat,
  );
  if (shortfall) throw new Error(`Can't swap: ${shortfall}`);
}

function rgbAvailable(): boolean {
  const a = protocolManager.getAdapterIfAvailable('RGB_LN');
  return !!a?.isConnected() && kaleidoClientManager.isInitialized();
}
function flashnetAvailable(): boolean {
  return flashnetClientManager.isInitialized();
}
function requireSwaps(): void {
  if (!rgbAvailable() && !flashnetAvailable()) {
    throw new Error('Connect your RGB Lightning or Spark wallet to swap.');
  }
}
function maker(): any { return kaleidoClientManager.getClient().maker; }
function rln(): any { return kaleidoClientManager.getClient().rln; }
function flashnet(): any { return flashnetClientManager.getClient(); }

/** Load pairs from every connected venue, tagged with `venue`. Mirrors the
 *  SwapScreen dual-load (maker pairs + Flashnet pools with Spark inventory). */
async function loadAllPairs(): Promise<SwapPair[]> {
  const out: SwapPair[] = [];

  if (rgbAvailable()) {
    try {
      const raw: any = await maker().listPairs();
      out.push(...normalizeMakerPairs(raw?.pairs ?? raw ?? []));
    } catch (e) { log('maker pairs failed', e); }
  }

  if (flashnetAvailable()) {
    try {
      const client = flashnet();
      const pools: any = await client.listPools({ sort: 'TVL_DESC' });
      const poolArray: any[] = Array.isArray(pools) ? pools : pools?.pools ?? [];
      // listPools returns hex pubkeys; encode each side to bech32m so the pair
      // builder can recognise USDB and match held Spark assets.
      const enriched = poolArray.map((p: any) => {
        const encode = (addr?: string) => {
          if (!addr || addr === BTC_ASSET_PUBKEY) return undefined;
          try { return client.encodeTokenAddress(addr); } catch { return undefined; }
        };
        return {
          ...p,
          assetABech32Address: p.assetABech32Address ?? encode(p.assetAAddress),
          assetBBech32Address: p.assetBBech32Address ?? encode(p.assetBAddress),
        };
      });
      const sparkAssets: any[] = (await protocolManager.getAdapterIfAvailable('SPARK')?.listAssets?.().catch(() => [])) ?? [];
      const inventory = sparkAssets.map((a) => ({ asset_id: a.id ?? a.asset_id, ticker: a.ticker, name: a.name, precision: a.precision }));
      out.push(...buildFlashnetPairs(enriched, inventory));
    } catch (e) { log('flashnet pairs failed', e); }
  }

  return out;
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  // ── market (read) ──
  kaleidoswap_get_assets: async () => {
    requireSwaps();
    const pairs = await loadAllPairs();
    const seen = new Map<string, unknown>();
    for (const p of pairs) {
      for (const a of [p.base, p.quote]) {
        if (a?.ticker && !seen.has(a.ticker)) {
          seen.set(a.ticker, { ticker: a.ticker, asset_id: getAssetId(a), precision: a.precision, venue: p.venue ?? 'kaleidoswap' });
        }
      }
    }
    return { assets: [...seen.values()] };
  },

  kaleidoswap_get_pairs: async () => {
    requireSwaps();
    const pairs = await loadAllPairs();
    return { pairs: pairs.map((p) => ({ base: p.base.ticker, quote: p.quote.ticker, venue: p.venue ?? 'kaleidoswap' })) };
  },

  kaleidoswap_get_quote: async ({ from_asset, to_asset, amount, amount_side }) => {
    requireSwaps();
    if (amount_side === 'to') throw new Error('Quote by the amount to sell: pass from_amount, not to_amount.');
    const from = String(from_asset ?? '').toUpperCase();
    const to = String(to_asset ?? '').toUpperCase();
    const amt = Number(amount);
    if (!from || !to) throw new Error('from_asset and to_asset are required.');
    if (!amt || Number.isNaN(amt) || amt <= 0) throw new Error('A positive amount is required.');
    const { id, quote, price } = await fetchQuote(from, to, amt);
    quoteCache.set(id, quote);
    return {
      quote_id: id,
      venue: quote.venue,
      from_asset: from,
      to_asset: to,
      send_amount: amt,
      receive_amount: quote.receiveAmount,
      receive_unit: quote.receiveUnit,
      price,
      fee: quote.fee,
      fee_unit: quote.feeUnit,
      expires_at: Math.floor(quote.expiresAt / 1000),
    };
  },

  kaleidoswap_get_nodeinfo: async () => {
    if (!rgbAvailable()) throw new Error('Maker node info needs an RGB Lightning connection.');
    return maker().getSwapNodeInfo();
  },

  // ── execute (core `execute_swap`) ──
  // SPEND (confirmation-gated). Routes to the cached quote's venue and runs that
  // venue's tested execution flow after the user approves.
  execute_swap: async ({ quote_id }) => {
    requireSwaps();
    const id = String(quote_id ?? '');
    const q = quoteCache.get(id);
    if (!q) throw new Error('That quote is no longer available — please get a fresh quote first.');
    if (Date.now() - q.ts > QUOTE_TTL_MS || Date.now() >= q.expiresAt) {
      quoteCache.delete(id);
      throw new Error('That quote expired — please re-quote before swapping.');
    }

    if (q.venue === 'flashnet') {
      const res: any = await flashnet().executeSwap({
        poolId: q.poolId,
        assetInAddress: q.fromAssetId,
        assetOutAddress: q.toAssetId,
        amountIn: String(q.rawFromAmount),
        minAmountOut: String(Math.floor(q.rawToAmount * 0.95)), // bound slippage at 5%
        maxSlippageBps: DEFAULT_FLASHNET_SLIPPAGE_BPS,
      });
      quoteCache.delete(id);
      log('flashnet swap done', { id });
      return { atomic_id: id, venue: 'flashnet', status: 'completed', txid: res?.outboundTransferId ?? '' };
    }

    await assertChannelCapacity(q);
    // KaleidoSwap atomic: init → verify terms → whitelist → taker → execute.
    const init: any = await maker().initSwap({
      rfq_id: q.rfqId ?? id,
      from_asset: q.fromAssetId,
      from_amount: q.rawFromAmount,
      to_asset: q.toAssetId,
      to_amount: q.rawToAmount,
    });
    const swapstring = init?.swapstring ?? init?.swap_string ?? '';
    const paymentHash = init?.payment_hash ?? '';
    if (!validateSwapString(swapstring, q.rawFromAmount, q.fromAssetId, q.rawToAmount, q.toAssetId, paymentHash)) {
      throw new Error('Swap verification failed — the maker terms did not match your quote. Aborted for your safety.');
    }
    await rln().whitelistSwap(swapstring);
    const takerPubkey = await rln().getTakerPubkey();
    await maker().executeSwap({ swapstring, taker_pubkey: takerPubkey, payment_hash: paymentHash });
    quoteCache.delete(id);
    log('maker swap executing', { id });
    // The maker tracks atomic swaps by payment hash.
    return { atomic_id: paymentHash, venue: 'kaleidoswap', status: 'executing', payment_hash: paymentHash };
  },

  // ── atomic status ──
  kaleidoswap_atomic_status: async ({ atomic_id }) => {
    requireSwaps();
    const id = String(atomic_id ?? '');
    // Flashnet settles instantly (no status endpoint).
    if (id.startsWith('flashnet-')) return { atomic_id: id, status: 'completed' };
    const a = protocolManager.getAdapterIfAvailable('RGB_LN');
    const s: any = await a?.getSwapStatus?.(id);
    return { atomic_id: id, status: s?.status ?? 'pending' };
  },
};

/** Build the on-device, venue-aware KaleidoSwap/Flashnet tool source: the
 *  contract's market tools + `kaleidoswap_atomic_status`, and the core
 *  `execute_swap` as the (confirmation-gated) execute path. */
export function buildSwapToolSource(): ToolSource {
  const executeSwap = getWalletTool('execute_swap');
  if (!executeSwap) throw new Error('@kaleidorg/mind has no execute_swap tool');
  const defs = [
    ...kaleidoswapTools({ groups: ['market', 'atomic'] }).filter((d) => HANDLERS[d.name]),
    executeSwap,
  ];
  return new InProcessToolSource('kaleidoswap', defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    requiresConfirmation: d.requiresConfirmation,
    handler: (args: Record<string, unknown>) => HANDLERS[d.name]!(normalizeKaleidoswapArgs(d.name, args)),
  })));
}
