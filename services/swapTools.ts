// Mobile binding for the canonical @kaleidorg/mind KaleidoSwap contract.
//
// Registers the kaleidoswap_* `market` + `orders` tools (assets, pairs, quote,
// node info, place order, order status/history) bound to rate's ON-DEVICE maker
// SDK over the RGB Lightning node — no MCP, no P2P delegation. Execution
// replicates the exact, tested SwapScreen atomic flow:
//   get_quote → initSwap → validateSwapString → whitelistSwap → executeSwap
// including the swapstring anti-tamper check. `place_order` is a spend →
// confirmation-gated by the contract (the engine pauses for the confirm sheet).
//
// The contract's `atomic` group is intentionally NOT bound: its
// atomic_init(receive_invoice) / atomic_execute shape describes an
// invoice-based protocol that doesn't match rate's HTLC swap flow. On mobile,
// `place_order` is the single on-device execute path (quote in → swap out).

import { bindKaleidoswapTools, type ToolSource } from '@kaleidorg/mind';
import { protocolManager, kaleidoClientManager } from './protocols';
import {
  normalizeMakerPairs,
  findPair,
  getPairAsset,
  getAssetId,
  isBtcTicker,
  getQuoteLayers,
  validateSwapString,
  MSATS_PER_SAT,
  type SwapPair,
} from '../utils/swap-model';

const log = (...a: any[]) => { try { console.log('[AI/swap]', ...a); } catch { /* noop */ } };

/** Quotes are short-lived; cache the maker-quoted raw legs so place_order
 *  re-uses the EXACT integers the maker encoded (re-deriving them from the
 *  rounded display amount is what previously broke execution + validation). */
const QUOTE_TTL_MS = 60_000;
interface CachedQuote {
  fromAssetId: string;
  toAssetId: string;
  rawFromAmount: number;
  rawToAmount: number;
  ts: number;
}
const quoteCache = new Map<string, CachedQuote>();

function requireRgb(): void {
  const a = protocolManager.getAdapterIfAvailable('RGB');
  if (!a?.isConnected() || !kaleidoClientManager.isInitialized()) {
    throw new Error('Connect your RGB Lightning wallet to trade on KaleidoSwap.');
  }
}
function maker(): any { return kaleidoClientManager.getClient().maker; }
function rln(): any { return kaleidoClientManager.getClient().rln; }

async function loadPairs(): Promise<SwapPair[]> {
  const raw: any = await maker().listPairs();
  return normalizeMakerPairs(raw?.pairs ?? raw ?? []);
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  // ── market (read) ──
  kaleidoswap_get_assets: async () => {
    requireRgb();
    const res: any = await maker().listAssets();
    const list: any[] = res?.assets ?? res ?? [];
    return {
      assets: list.map((a) => ({
        ticker: a.ticker,
        asset_id: a.asset_id ?? a.assetId,
        precision: a.precision ?? 8,
      })),
    };
  },

  kaleidoswap_get_pairs: async () => {
    requireRgb();
    const pairs = await loadPairs();
    return { pairs: pairs.map((p) => ({ base: p.base.ticker, quote: p.quote.ticker })) };
  },

  kaleidoswap_get_quote: async ({ from_asset, to_asset, amount }) => {
    requireRgb();
    const from = String(from_asset ?? '').toUpperCase();
    const to = String(to_asset ?? '').toUpperCase();
    const amt = Number(amount);
    if (!from || !to) throw new Error('from_asset and to_asset are required.');
    if (!amt || Number.isNaN(amt) || amt <= 0) throw new Error('A positive amount is required.');

    const pairs = await loadPairs();
    const pair = findPair(pairs, from, to);
    if (!pair) throw new Error(`No KaleidoSwap pair for ${from}/${to}.`);
    const fromA = getPairAsset(pair, from);
    const toA = getPairAsset(pair, to);
    if (!fromA || !toA) throw new Error(`Couldn't resolve the assets for ${from}/${to}.`);
    const fromAssetId = getAssetId(fromA);
    const toAssetId = getAssetId(toA);

    // Agent unit contract: BTC amount is in SATS; an RGB asset amount is in
    // display units. The maker quotes BTC in msats (×1000) and RGB in raw
    // smallest units (×10^precision).
    const rawFromAmount = isBtcTicker(from)
      ? Math.round(amt * MSATS_PER_SAT)
      : Math.round(amt * Math.pow(10, fromA.precision));

    const { fromLayer, toLayer } = getQuoteLayers(pair, fromAssetId, toAssetId);
    const resp: any = await maker().getQuote({
      from_asset: { asset_id: fromAssetId, layer: fromLayer, amount: rawFromAmount },
      to_asset: { asset_id: toAssetId, layer: toLayer },
    });
    const rfqId = resp?.rfq_id;
    if (!rfqId) throw new Error('The maker did not return a quote — try again.');

    // Keep the maker's exact integers verbatim for initSwap + swapstring check.
    const rawToAmount = Number(resp?.to_asset?.amount ?? 0);
    const rawFromQuoted = Number(resp?.from_asset?.amount ?? rawFromAmount);
    quoteCache.set(rfqId, { fromAssetId, toAssetId, rawFromAmount: rawFromQuoted, rawToAmount, ts: Date.now() });

    const receiveDisplay = isBtcTicker(to)
      ? rawToAmount / MSATS_PER_SAT
      : rawToAmount / Math.pow(10, toA.precision);
    log('quote', { rfqId, from, to, amt, receiveDisplay });
    return {
      quote_id: rfqId,
      from_asset: from,
      to_asset: to,
      send_amount: amt,
      receive_amount: receiveDisplay,
      receive_unit: isBtcTicker(to) ? 'sats' : to,
      price: resp?.price,
      fee: resp?.fee?.final_fee,
      expires_at: resp?.expires_at,
    };
  },

  kaleidoswap_get_nodeinfo: async () => {
    requireRgb();
    return maker().getSwapNodeInfo();
  },

  // ── orders ──
  // SPEND (confirmation-gated by the contract). Runs the full tested atomic
  // sequence after the user approves; aborts if the maker's swapstring doesn't
  // encode the exact quoted terms.
  kaleidoswap_place_order: async ({ quote_id }) => {
    requireRgb();
    const id = String(quote_id ?? '');
    const q = quoteCache.get(id);
    if (!q) throw new Error('That quote is no longer available — please get a fresh quote first.');
    if (Date.now() - q.ts > QUOTE_TTL_MS) {
      quoteCache.delete(id);
      throw new Error('That quote expired — please re-quote before ordering.');
    }

    const init: any = await maker().initSwap({
      rfq_id: id,
      from_asset: q.fromAssetId,
      from_amount: q.rawFromAmount,
      to_asset: q.toAssetId,
      to_amount: q.rawToAmount,
    });
    const swapstring = init?.swapstring ?? init?.swap_string ?? '';
    const paymentHash = init?.payment_hash ?? '';

    // Anti-tamper: the maker's swapstring MUST encode the exact terms we quoted.
    if (!validateSwapString(swapstring, q.rawFromAmount, q.fromAssetId, q.rawToAmount, q.toAssetId, paymentHash)) {
      throw new Error('Swap verification failed — the maker terms did not match your quote. Aborted for your safety.');
    }

    await rln().whitelistSwap(swapstring);
    const takerPubkey = await rln().getTakerPubkey();
    await maker().executeSwap({ swapstring, taker_pubkey: takerPubkey, payment_hash: paymentHash });

    quoteCache.delete(id);
    log('order executing', { id });
    return { order_id: id, status: 'executing', payment_hash: paymentHash };
  },

  kaleidoswap_get_order_status: async ({ order_id }) => {
    requireRgb();
    const a = protocolManager.getAdapterIfAvailable('RGB');
    const s: any = await a?.getSwapStatus?.(String(order_id));
    return { order_id, status: s?.status ?? 'pending' };
  },

  kaleidoswap_get_order_history: async ({ limit, cursor }) => {
    requireRgb();
    const params: Record<string, unknown> = {};
    if (limit != null) params.limit = Number(limit);
    if (cursor) params.cursor = String(cursor);
    return (await maker().getOrderHistory?.(params)) ?? { orders: [] };
  },
};

/** Build the on-device KaleidoSwap tool source (market + orders groups). */
export function buildSwapToolSource(): ToolSource {
  return bindKaleidoswapTools(HANDLERS, { groups: ['market', 'orders'] });
}
