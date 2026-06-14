// Mobile binding for the canonical @kaleidorg/mind KaleidoSwap contract,
// venue-aware: the same kaleidoswap_* tools transparently quote + execute on
// EITHER venue, picked by the pair —
//   - KaleidoSwap maker (RGB Lightning node)  → atomic HTLC swap
//   - Flashnet (Spark DEX pool)               → single-step AMM swap
// All ON-DEVICE — no MCP, no P2P delegation. The two venues use disjoint asset
// tickers (RGB USDT/XAUT vs Spark USDB), so the ticker selects the venue.
//
// Execution replicates rate's tested SwapScreen flows verbatim:
//   - maker:    get_quote → initSwap → validateSwapString → whitelist → execute
//   - flashnet: simulateSwap → executeSwap (minAmountOut floored at 95%)
// `place_order` is a spend → confirmation-gated by the contract.
//
// The contract's `atomic` group is intentionally NOT bound (its invoice-based
// shape doesn't match either on-device flow); `place_order` is the execute path.

import { bindKaleidoswapTools, type ToolSource } from '@kaleidorg/mind';
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
  MSATS_PER_SAT,
  DEFAULT_FLASHNET_SLIPPAGE_BPS,
  type SwapPair,
} from '../utils/swap-model';
import { BTC_ASSET_PUBKEY } from '../utils/flashnet';

const log = (...a: any[]) => { try { console.log('[AI/swap]', ...a); } catch { /* noop */ } };

type Venue = 'kaleidoswap' | 'flashnet';

/** Quotes are short-lived; cache the exact integers the venue quoted so
 *  place_order re-uses them verbatim (re-deriving from a rounded display amount
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
}
const quoteCache = new Map<string, CachedQuote>();

function rgbAvailable(): boolean {
  const a = protocolManager.getAdapterIfAvailable('RGB');
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

  kaleidoswap_get_quote: async ({ from_asset, to_asset, amount }) => {
    requireSwaps();
    const from = String(from_asset ?? '').toUpperCase();
    const to = String(to_asset ?? '').toUpperCase();
    const amt = Number(amount);
    if (!from || !to) throw new Error('from_asset and to_asset are required.');
    if (!amt || Number.isNaN(amt) || amt <= 0) throw new Error('A positive amount is required.');

    const pairs = await loadAllPairs();
    const pair = findPair(pairs, from, to);
    if (!pair) throw new Error(`No swap pair for ${from}/${to} on a connected venue.`);
    const fromA = getPairAsset(pair, from);
    const toA = getPairAsset(pair, to);
    if (!fromA || !toA) throw new Error(`Couldn't resolve the assets for ${from}/${to}.`);
    const fromAssetId = getAssetId(fromA);
    const toAssetId = getAssetId(toA);

    // ── Flashnet (Spark AMM): BTC settles in SATS; assets in raw smallest units.
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
      const quoteId = `flashnet-${Date.now()}`;
      quoteCache.set(quoteId, { venue: 'flashnet', fromAssetId, toAssetId, rawFromAmount, rawToAmount, poolId, ts: Date.now() });
      log('flashnet quote', { quoteId, from, to, amt, rawToAmount });
      return {
        quote_id: quoteId,
        venue: 'flashnet',
        from_asset: from,
        to_asset: to,
        send_amount: amt,
        receive_amount: isBtcTicker(to) ? rawToAmount : rawToAmount / Math.pow(10, toA.precision),
        receive_unit: isBtcTicker(to) ? 'sats' : to,
        price: sim?.executionPrice,
        fee: isBtcTicker(from) ? rawFee : rawFee / Math.pow(10, fromA.precision),
        expires_at: Math.floor(Date.now() / 1000) + 30,
      };
    }

    // ── KaleidoSwap maker (RGB/RLN): BTC quoted in MSATS (×1000).
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
    quoteCache.set(rfqId, { venue: 'kaleidoswap', fromAssetId, toAssetId, rawFromAmount: rawFromQuoted, rawToAmount, ts: Date.now() });
    log('maker quote', { rfqId, from, to, amt, rawToAmount });
    return {
      quote_id: rfqId,
      venue: 'kaleidoswap',
      from_asset: from,
      to_asset: to,
      send_amount: amt,
      receive_amount: isBtcTicker(to) ? rawToAmount / MSATS_PER_SAT : rawToAmount / Math.pow(10, toA.precision),
      receive_unit: isBtcTicker(to) ? 'sats' : to,
      price: resp?.price,
      fee: resp?.fee?.final_fee,
      expires_at: resp?.expires_at,
    };
  },

  kaleidoswap_get_nodeinfo: async () => {
    if (!rgbAvailable()) throw new Error('Maker node info needs an RGB Lightning connection.');
    return maker().getSwapNodeInfo();
  },

  // ── orders ──
  // SPEND (confirmation-gated). Routes to the cached quote's venue and runs that
  // venue's tested execution flow after the user approves.
  kaleidoswap_place_order: async ({ quote_id }) => {
    requireSwaps();
    const id = String(quote_id ?? '');
    const q = quoteCache.get(id);
    if (!q) throw new Error('That quote is no longer available — please get a fresh quote first.');
    if (Date.now() - q.ts > QUOTE_TTL_MS) {
      quoteCache.delete(id);
      throw new Error('That quote expired — please re-quote before ordering.');
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
      log('flashnet order done', { id });
      return { order_id: id, venue: 'flashnet', status: 'completed', txid: res?.outboundTransferId ?? '' };
    }

    // KaleidoSwap atomic: init → verify terms → whitelist → taker → execute.
    const init: any = await maker().initSwap({
      rfq_id: id,
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
    log('maker order executing', { id });
    return { order_id: id, venue: 'kaleidoswap', status: 'executing', payment_hash: paymentHash };
  },

  kaleidoswap_get_order_status: async ({ order_id }) => {
    requireSwaps();
    const id = String(order_id);
    // Flashnet settles instantly (no status endpoint).
    if (id.startsWith('flashnet-')) return { order_id: id, status: 'completed' };
    const a = protocolManager.getAdapterIfAvailable('RGB');
    const s: any = await a?.getSwapStatus?.(id);
    return { order_id: id, status: s?.status ?? 'pending' };
  },

  kaleidoswap_get_order_history: async ({ limit, cursor }) => {
    if (!rgbAvailable()) return { orders: [] };
    const params: Record<string, unknown> = {};
    if (limit != null) params.limit = Number(limit);
    if (cursor) params.cursor = String(cursor);
    return (await maker().getOrderHistory?.(params)) ?? { orders: [] };
  },
};

/** Build the on-device, venue-aware KaleidoSwap/Flashnet tool source. */
export function buildSwapToolSource(): ToolSource {
  return bindKaleidoswapTools(HANDLERS, { groups: ['market', 'orders'] });
}
