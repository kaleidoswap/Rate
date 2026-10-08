import { protocolManager, kaleidoClientManager, flashnetClientManager } from './protocols';
import { SwapPair, getAssetId, getQuoteLayers, isFlashnetPair, isBtcTicker, swapChannelShortfall, DEFAULT_FLASHNET_SLIPPAGE_BPS, RLN_HTLC_MIN_MSAT } from '../utils/swap-model';
import type { SwapQuote } from '../store/slices/swapSlice';

const quoteClients = new WeakMap<SwapQuote, unknown>();
/** Fail closed when settings/reconnection replaced the provider after review. */
export function assertSwapQuoteProvider(quote: SwapQuote): void {
  const client = quote.venue === 'flashnet' ? flashnetClientManager.getClient() : kaleidoClientManager.getClient();
  if (quoteClients.get(quote) !== client) throw new Error('Provider connection changed. Refresh and review a new quote.');
}
export interface SwapOffer { id: string; pair: SwapPair; quote?: SwapQuote; unavailable?: string }
export const swapProviderKey = (pair: SwapPair) => JSON.stringify([pair.venue ?? 'kaleidoswap', pair.poolId ?? pair.id ?? '', pair.base.protocol_ids, pair.quote.protocol_ids, pair.routes]);
export const swapProviderName = (pair: SwapPair) => isFlashnetPair(pair) ? 'Flashnet' : 'KaleidoSwap';
/** Only compare identical assets on identical rails. A matching ticker alone is insufficient. */
export function bestSwapOffer(offers: SwapOffer[]): SwapOffer | undefined {
  const valid = offers.filter(o => o.quote && o.quote.expiry_timestamp > Date.now());
  if (!valid.length) return undefined;
  const identity = (o: SwapOffer) => JSON.stringify([o.quote!.from_asset_id, o.quote!.to_asset_id, o.pair.venue, o.pair.routes, o.quote!.from_amount]);
  if (valid.some(o => identity(o) !== identity(valid[0]))) return undefined;
  return valid.reduce((best, o) => o.quote!.to_amount > best.quote!.to_amount ? o : best);
}
export async function fetchSwapQuote(pair: SwapPair, fromTicker: string, toTicker: string, fromAmount: number, unit: string): Promise<SwapQuote> {
  const from = pair.base.ticker === fromTicker ? pair.base : pair.quote;
  const to = pair.base.ticker === toTicker ? pair.base : pair.quote;
  const fromId = getAssetId(from), toId = getAssetId(to);
  const toSats = (value: number) => unit === 'sats' ? value : Math.round(value * 1e8);
  const fromSats = (value: number) => unit === 'sats' ? value : value / 1e8;
  const flash = isFlashnetPair(pair);
  const rawInput = isBtcTicker(fromTicker) ? toSats(fromAmount) * (flash ? 1 : 1000) : Math.round(fromAmount * 10 ** from.precision);
  if (!Number.isSafeInteger(rawInput) || rawInput <= 0) throw new Error('Enter a valid amount.');
  const client = flash ? flashnetClientManager.getClient() : kaleidoClientManager.getClient();
  let quote: SwapQuote;
  if (flash) {
    const poolId = pair.poolId || flashnetClientManager.getPoolId();
    if (!poolId) throw new Error('Pool unavailable.');
    const sim: any = await (client as ReturnType<typeof flashnetClientManager.getClient>).simulateSwap({ poolId, assetInAddress: fromId, assetOutAddress: toId, amountIn: String(rawInput), maxSlippageBps: DEFAULT_FLASHNET_SLIPPAGE_BPS } as any);
    const rawOutput = Number(sim?.amountOut ?? sim?.amount_out);
    const rawFee = Number(sim?.feePaidAssetIn ?? sim?.fee_paid_asset_in);
    if (!Number.isSafeInteger(rawFee) || rawFee < 0) throw new Error('Provider returned an invalid fee.');
    quote = { rfq_id: `flashnet-${poolId}-${Date.now()}`, from_asset: fromTicker, to_asset: toTicker, from_amount: fromAmount,
      to_amount: isBtcTicker(toTicker) ? fromSats(rawOutput) : rawOutput / 10 ** to.precision,
      fee_amount: isBtcTicker(fromTicker) ? fromSats(rawFee) : rawFee / 10 ** from.precision,
      exchange_rate: 0, expiry_timestamp: Date.now() + 30000, maker_pubkey: poolId, venue: 'flashnet',
      from_asset_id: fromId, to_asset_id: toId, from_amount_raw: rawInput, to_amount_raw: rawOutput };
  } else {
    if (!kaleidoClientManager.isInitialized()) throw new Error('Connect an RGB node to use this provider.');
    const { fromLayer, toLayer } = getQuoteLayers(pair, fromId, toId);
    const response: any = await (client as ReturnType<typeof kaleidoClientManager.getClient>).maker.getQuote({
      from_asset: { asset_id: fromId, layer: fromLayer as any, amount: rawInput }, to_asset: { asset_id: toId, layer: toLayer as any },
    });
    const rawOutput = Number(response.to_asset?.amount);
    if (response.from_asset?.asset_id !== fromId || response.to_asset?.asset_id !== toId || Number(response.from_asset?.amount) !== rawInput || !response.rfq_id) throw new Error('Provider returned different swap terms.');
    const fee = Number(response.fee?.final_fee);
    const feePrecision = response.fee?.fee_asset_precision ?? to.precision;
    if (!Number.isSafeInteger(fee) || fee < 0 || !Number.isInteger(feePrecision) || feePrecision < 0 || feePrecision > 18) throw new Error('Provider returned an invalid fee.');
    quote = { rfq_id: response.rfq_id, from_asset: fromTicker, to_asset: toTicker, from_amount: fromAmount,
      to_amount: isBtcTicker(toTicker) ? fromSats(rawOutput / 1000) : rawOutput / 10 ** to.precision,
      fee_amount: isBtcTicker(toTicker) ? fromSats(fee / 10 ** feePrecision * 1e8) : fee / 10 ** feePrecision,
      exchange_rate: 0, expiry_timestamp: Number(response.expires_at) * 1000, maker_pubkey: response.maker_pubkey ?? '', venue: 'kaleidoswap',
      from_asset_id: fromId, to_asset_id: toId, from_amount_raw: rawInput, to_amount_raw: rawOutput };
  }
  if (!Number.isSafeInteger(quote.to_amount_raw) || quote.to_amount_raw! <= 0 || !Number.isFinite(quote.expiry_timestamp) || quote.expiry_timestamp <= Date.now()) throw new Error('Provider returned an empty or expired quote.');
  quote.exchange_rate = quote.to_amount / fromAmount;
  quoteClients.set(quote, client);
  return quote;
}
export async function fetchSwapOffers(pairs: SwapPair[], from: string, to: string, amount: number, unit: string): Promise<SwapOffer[]> {
  const matches = pairs.filter(p => (p.base.ticker === from && p.quote.ticker === to) || (p.base.ticker === to && p.quote.ticker === from));
  return Promise.all([...new Map(matches.map(p => [swapProviderKey(p), p])).values()].map(async pair => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offer: SwapOffer = { id: swapProviderKey(pair), pair: JSON.parse(JSON.stringify(pair)) };
    try {
      offer.quote = await Promise.race([fetchSwapQuote(offer.pair, from, to, amount, unit), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider did not respond.')), 15000); })]);
    } catch (e) { offer.unavailable = e instanceof Error ? e.message : 'Quote unavailable'; }
    finally { if (timer) clearTimeout(timer); }
    return offer;
  }));
}
/** The RGB node's channels and HTLC minimum. `channels` is undefined when no node is connected or they can't be read. */
export interface ChannelLiquidity { channels?: unknown[]; htlcMinMsat: number }
export async function loadChannelLiquidity(): Promise<ChannelLiquidity> {
  const a: any = protocolManager.getAdapterIfAvailable('RGB_LN');
  if (typeof a?.listChannels !== 'function' || a.isConnected?.() === false) return { htlcMinMsat: RLN_HTLC_MIN_MSAT };
  const [channels, info] = await Promise.all([
    a.listChannels().catch(() => undefined),
    typeof a.getNodeInfo === 'function' ? a.getNodeInfo().catch(() => undefined) : undefined,
  ]);
  const minMsat = Number(info?.rgb_htlc_min_msat);
  return { channels: Array.isArray(channels) ? channels : undefined, htlcMinMsat: Number.isFinite(minMsat) && minMsat > 0 ? minMsat : RLN_HTLC_MIN_MSAT };
}
/** Why the node's channels can't carry this maker quote, or null (Flashnet, unknown channels, or enough liquidity). */
export function quoteChannelShortfall(quote: SwapQuote, liquidity: ChannelLiquidity, label = (amount: number, ticker: string) => `${amount} ${ticker}`): string | null {
  if (quote.venue === 'flashnet' || !liquidity.channels) return null;
  if (!quote.from_asset_id || !quote.to_asset_id || quote.from_amount_raw == null || quote.to_amount_raw == null) return null;
  return swapChannelShortfall(
    { assetId: quote.from_asset_id, ticker: quote.from_asset, raw: quote.from_amount_raw, label: label(quote.from_amount, quote.from_asset) },
    { assetId: quote.to_asset_id, ticker: quote.to_asset, raw: quote.to_amount_raw, label: label(quote.to_amount, quote.to_asset) },
    liquidity.channels, liquidity.htlcMinMsat,
  );
}
