/**
 * Arkade -> Lightning through Arkade Intents (RFQ solvers), as a KaleidoPay swap.
 *
 * Providers are the solvers the network's solver registry lists for the
 * `arkade:BTC -> lightning:BTC` corridor (each reached over its card's Nostr
 * relays), plus the KaleidoSwap maker over HTTP.
 *
 * Reviewing a payment never contacts a solver: every RFQ is a real negotiation
 * that registers a lockup contract in the wallet, so quotes are ESTIMATES priced
 * from each provider's published card (fee_bps / fee_flat, min / max). The one
 * binding RFQ goes to the provider the user chose, at execute time, and is
 * refused (nothing funded) when it asks for more than the approved total.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode as decodeBolt11Raw } from 'light-bolt11-decoder';
import type {
  ArkadeIntentsVenue, ArkadeSwapPhase, ArkadeSwapRecord, ArkadeSwapStore, ReconcileReport,
} from '@kaleidorg/swap-sdk/arkade';
import type { InvoiceFacts, RfqTransport } from '@arkade-os/swap';
import type { AccountQuoteOption, Network, PaymentResult, Preview, Quote, Route, SwapCapability } from './index';
import { PaymentNotSentError } from './errors';

export const ARKADE_SOLVER_REGISTRY = 'https://arkade-os.github.io/solver-registry';
export const ARKADE_INTENTS_SWAP_ID = 'arkade-intents';
const KALEIDOSWAP_PROVIDER = 'kaleidoswap';
const MARKETS_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;
/** How long an estimate is offered for; the binding quote is fetched at execute anyway. */
const QUOTE_TTL_S = 60;
/** The invoice must outlive the swap's funding window by at least this much. */
const INVOICE_MARGIN_S = 120;

// ---------------------------------------------------------------------------
// Lazy module loading. Static require strings so Metro bundles them; executed
// only when an Arkade swap is actually quoted, paid or recovered.
// ---------------------------------------------------------------------------
interface IntentsModules {
  venue: typeof import('@kaleidorg/swap-sdk/arkade');
  swap: typeof import('@arkade-os/swap');
  nostr: typeof import('@arkade-os/swap/nostr');
}
let modules: IntentsModules | null = null;
function load(): IntentsModules {
  modules ??= {
    venue: require('@kaleidorg/swap-sdk/arkade'),
    swap: require('@arkade-os/swap'),
    nostr: require('@arkade-os/swap/nostr'),
  };
  return modules;
}

// ---------------------------------------------------------------------------
// Persistent venue store (AsyncStorage). Records hold public data only: the
// signer and preimage are re-derived from the wallet.
// ---------------------------------------------------------------------------
const RECORD_PREFIX = 'kaleidopay-arkade-intents-record:';
export function createAsyncStorageArkadeSwapStore(prefix = RECORD_PREFIX): ArkadeSwapStore {
  const read = async (key: string): Promise<ArkadeSwapRecord | undefined> => {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return undefined;
    try { return JSON.parse(raw) as ArkadeSwapRecord; } catch { return undefined; }
  };
  return {
    async put(record) { await AsyncStorage.setItem(prefix + record.id, JSON.stringify(record)); },
    get: id => read(prefix + id),
    async listPending() {
      const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix));
      const records = await Promise.all(keys.map(read));
      return records.filter((r): r is ArkadeSwapRecord => !!r && (r.phase === 'prepared' || r.phase === 'funded'));
    },
  };
}
export const arkadeIntentsStore: ArkadeSwapStore = createAsyncStorageArkadeSwapStore();

// ---------------------------------------------------------------------------
// Providers and card-based estimates.
// ---------------------------------------------------------------------------
/** The subset of a solver market (card / registry entry) the estimate reads. */
export interface IntentsMarket {
  solver?: string;
  discovery_pubkey?: string;
  base_asset: { id: string };
  quote_asset: { id: string };
  base_corridor?: string;
  quote_corridor?: string;
  fee_bps: number;
  fee_flat?: string;
  min_base_amount: string; max_base_amount: string;
  min_quote_amount: string; max_quote_amount: string;
  transports?: { nostr?: { relays?: string[] } };
}
export interface IntentsProvider {
  id: string;
  name: string;
  detail: string;
  market: IntentsMarket;
  transport: () => RfqTransport;
}

const corridor = (c?: string) => c ?? 'arkade';
/** The market's Arkade (we give) and Lightning (solver pays) sides, when it is the BTC send corridor. */
function lightningSendSides(m: IntentsMarket): { ark: 'base' | 'quote'; ln: 'base' | 'quote' } | null {
  if (m?.base_asset?.id !== 'btc' || m?.quote_asset?.id !== 'btc') return null;
  const base = corridor(m.base_corridor), quote = corridor(m.quote_corridor);
  if (base === 'arkade' && quote === 'lightning') return { ark: 'base', ln: 'quote' };
  if (base === 'lightning' && quote === 'arkade') return { ark: 'quote', ln: 'base' };
  return null;
}
const bound = (m: IntentsMarket, side: 'base' | 'quote', which: 'min' | 'max') => {
  const v = Number(m[`${which}_${side}_amount` as keyof IntentsMarket]);
  return Number.isSafeInteger(v) && v >= 0 ? v : null;
};
export function isLightningSendMarket(m: IntentsMarket): boolean {
  const sides = lightningSendSides(m);
  return !!sides && (bound(m, sides.ln, 'max') ?? 0) > 0 && Number.isFinite(m.fee_bps) && m.fee_bps >= 0 && m.fee_bps < 10_000;
}

/**
 * What the provider's card says paying `amountSat` over Lightning should cost, in sats on
 * the Arkade side. The spread is applied to what we fund (conservative: from = to / (1 - bps)),
 * plus the flat fee. An estimate: the solver's RFQ quote is what binds.
 */
export function estimateLightningSend(m: IntentsMarket, amountSat: number): { feeSat: number } | { unavailable: string } {
  const sides = lightningSendSides(m);
  if (!sides || !isLightningSendMarket(m)) return { unavailable: 'This provider does not pay Lightning from Arkade.' };
  const flat = m.fee_flat === undefined ? 0 : Number(m.fee_flat);
  if (!Number.isSafeInteger(flat) || flat < 0) return { unavailable: 'This provider publishes no usable fee.' };
  const lnMin = bound(m, sides.ln, 'min'), lnMax = bound(m, sides.ln, 'max');
  if (lnMin === null || lnMax === null) return { unavailable: 'This provider publishes no usable limits.' };
  if (amountSat < lnMin) return { unavailable: `Below this provider's minimum of ${lnMin.toLocaleString()} sats.` };
  if (amountSat > lnMax) return { unavailable: `Above this provider's maximum of ${lnMax.toLocaleString()} sats.` };
  const feeSat = Math.ceil(amountSat * 10_000 / (10_000 - m.fee_bps)) - amountSat + flat;
  const arkMax = bound(m, sides.ark, 'max'), arkMin = bound(m, sides.ark, 'min');
  if (arkMax !== null && arkMax > 0 && amountSat + feeSat > arkMax) return { unavailable: `Above this provider's maximum of ${arkMax.toLocaleString()} sats.` };
  if (arkMin !== null && amountSat + feeSat < arkMin) return { unavailable: `Below this provider's minimum of ${arkMin.toLocaleString()} sats.` };
  return { feeSat };
}

/** A market whose solver can be paid over Lightning and pay out on Arkade. */
export function isLightningReceiveMarket(m: IntentsMarket): boolean {
  const sides = lightningSendSides(m);
  return !!sides && (bound(m, sides.ark, 'max') ?? 0) > 0 && Number.isFinite(m.fee_bps) && m.fee_bps >= 0 && m.fee_bps < 10_000;
}

/**
 * What the sender pays over Lightning for `amountSat` to land on Arkade, by the provider's
 * card: the spread on the Lightning side plus the flat fee. An estimate; the RFQ binds.
 */
export function estimateLightningReceive(m: IntentsMarket, amountSat: number): { payAmountSat: number } | { unavailable: string } {
  const sides = lightningSendSides(m);
  if (!sides || !isLightningReceiveMarket(m)) return { unavailable: 'This provider does not pay out on Arkade.' };
  const flat = m.fee_flat === undefined ? 0 : Number(m.fee_flat);
  if (!Number.isSafeInteger(flat) || flat < 0) return { unavailable: 'This provider publishes no usable fee.' };
  const arkMin = bound(m, sides.ark, 'min'), arkMax = bound(m, sides.ark, 'max');
  if (arkMin === null || arkMax === null) return { unavailable: 'This provider publishes no usable limits.' };
  if (amountSat < arkMin) return { unavailable: `Below this provider's minimum of ${arkMin.toLocaleString()} sats.` };
  if (amountSat > arkMax) return { unavailable: `Above this provider's maximum of ${arkMax.toLocaleString()} sats.` };
  const payAmountSat = Math.ceil(amountSat * 10_000 / (10_000 - m.fee_bps)) + flat;
  const lnMax = bound(m, sides.ln, 'max');
  if (lnMax !== null && lnMax > 0 && payAmountSat > lnMax) return { unavailable: `Above this provider's maximum of ${lnMax.toLocaleString()} sats.` };
  return { payAmountSat };
}

/** The KaleidoSwap maker's corridor root: its /v2 base without the /v2 (RN's URL has no settable pathname). */
export function makerCorridorRoot(makerUrl: string | null | undefined): string | null {
  const url = makerUrl?.trim().replace(/\/+$/, '');
  if (!url || /[?#]/.test(url) || !/^https?:\/\/[^/\s]+/i.test(url)) return null;
  if (/\/v2$/i.test(url)) return url.slice(0, -3);
  return /^https?:\/\/[^/\s]+$/i.test(url) ? url : null;
}

/** Solver-registry network name: the Ark server's own (`getInfo().network`) when known. */
export function registryNetwork(arkNetwork: string | undefined, network: Network): string {
  if (arkNetwork && ['bitcoin', 'signet', 'mutinynet', 'regtest'].includes(arkNetwork)) return arkNetwork;
  return network === 'mainnet' ? 'bitcoin' : network === 'testnet' ? 'signet' : network;
}

function timedFetch(fetchImpl: typeof fetch): typeof fetch {
  return ((input: any, init?: any) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
    return fetchImpl(input, { ...(init ?? {}), ...(controller ? { signal: controller.signal } : {}) })
      .finally(() => clearTimeout(timer));
  }) as typeof fetch;
}
const short = (key: string) => (key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key);

// ---------------------------------------------------------------------------
// BOLT11 facts the venue needs (its own decode; the venue takes facts, not a decoder).
// ---------------------------------------------------------------------------
export function invoiceFacts(invoice: string): InvoiceFacts {
  const raw = invoice.trim().replace(/^lightning:/i, '');
  const d: any = decodeBolt11Raw(raw);
  const sec = (n: string) => d.sections?.find((s: any) => s.name === n)?.value;
  const msat = Number(sec('amount'));
  const paymentHash = String(sec('payment_hash') ?? '').toLowerCase();
  const timestamp = Number(sec('timestamp'));
  const expiry = Number(d.expiry ?? sec('expiry') ?? 3600);
  if (!Number.isSafeInteger(msat) || msat <= 0) throw new Error('Arkade swaps can only pay Lightning invoices that state an amount.');
  if (msat % 1000 !== 0) throw new Error('The invoice amount is not a whole number of sats.');
  if (!/^[0-9a-f]{64}$/.test(paymentHash) || !Number.isSafeInteger(timestamp)) throw new Error('The Lightning invoice could not be read.');
  return { raw, paymentHash, amountSats: msat / 1000, expiresAt: timestamp + (Number.isSafeInteger(expiry) ? expiry : 3600) };
}

// ---------------------------------------------------------------------------
// Provider discovery, shared by Lightning sends and receives: the KaleidoSwap maker
// (over HTTP) first, then the solvers the registry lists (over Nostr).
// ---------------------------------------------------------------------------
interface ProviderSourceOptions {
  network: Network;
  arkNetwork: () => string | undefined;
  makerUrl?: string | null;
  registryUrl?: string;
  /** Already timed. */
  fetchImpl: typeof fetch;
}
type Listed = IntentsProvider | { id: string; name: string; unavailable: string };

function createProviderSource(opts: ProviderSourceOptions, accept: (m: IntentsMarket) => boolean, makerUnavailable: string) {
  const { network, fetchImpl } = opts;
  const makerRoot = makerCorridorRoot(opts.makerUrl);
  let cached: { at: number; key: string; list: IntentsProvider[] } | null = null;

  async function makerProvider(): Promise<Listed | null> {
    if (!makerRoot) return null;
    const name = 'KaleidoSwap';
    try {
      const res = await fetchImpl(`${makerRoot}/v1/card`, { method: 'GET' });
      const card = await res.json();
      const market = (Array.isArray(card?.markets) ? card.markets as IntentsMarket[] : []).find(accept);
      if (!res.ok || !market) return { id: KALEIDOSWAP_PROVIDER, name, unavailable: makerUnavailable };
      const discovery = typeof card.discovery_pubkey === 'string' ? card.discovery_pubkey : undefined;
      return {
        id: KALEIDOSWAP_PROVIDER, name, detail: 'KaleidoSwap maker',
        market: { ...market, discovery_pubkey: discovery },
        transport: () => load().swap.httpTransport(makerRoot, { fetchImpl }),
      };
    } catch {
      return { id: KALEIDOSWAP_PROVIDER, name, unavailable: 'KaleidoSwap did not publish its fees, so no estimate is available.' };
    }
  }

  async function registryProviders(): Promise<IntentsProvider[]> {
    const { swap, nostr } = load();
    const markets = await swap.discoverMarkets({
      network: registryNetwork(opts.arkNetwork(), network) as any,
      registryUrl: `${opts.registryUrl ?? ARKADE_SOLVER_REGISTRY}/${registryNetwork(opts.arkNetwork(), network)}.json`,
      fetchImpl,
    }) as unknown as IntentsMarket[];
    const out: IntentsProvider[] = [];
    for (const market of markets) {
      const key = market.discovery_pubkey?.toLowerCase();
      const relays = market.transports?.nostr?.relays?.filter(r => /^wss:\/\//i.test(r)) ?? [];
      if (!key || !/^[0-9a-f]{64}$/.test(key) || !relays.length || !accept(market)) continue;
      if (out.some(p => p.id === `solver:${key}`)) continue; // markets come ranked; keep the best per solver
      out.push({
        id: `solver:${key}`, name: market.solver ? `${market.solver}` : 'Arkade solver', detail: `Arkade Intents solver ${short(key)}`,
        market, transport: () => nostr.nostrRfqTransport({ relays, solverPubkey: key }),
      });
    }
    return out;
  }

  return async function providers(): Promise<Listed[]> {
    const key = `${registryNetwork(opts.arkNetwork(), network)}|${makerRoot}`;
    if (cached && cached.key === key && Date.now() - cached.at < MARKETS_TTL_MS) return cached.list;
    const [maker, solvers] = await Promise.all([makerProvider(), registryProviders().catch(() => [] as IntentsProvider[])]);
    // The maker is reached over HTTP; drop its own registry listing so it isn't offered twice.
    const makerKey = maker && 'market' in maker ? maker.market.discovery_pubkey?.toLowerCase() : undefined;
    const list: Listed[] = [...(maker ? [maker] : []), ...solvers.filter(s => !makerKey || s.id !== `solver:${makerKey}`)];
    if (list.every(p => 'market' in p)) cached = { at: Date.now(), key, list: list as IntentsProvider[] };
    return list;
  };
}

// ---------------------------------------------------------------------------
// The swap half of the Arkade account.
// ---------------------------------------------------------------------------
export interface ArkadeIntentsOptions {
  sourceId: string;
  /** The source rail (e.g. 'ark'). */
  rail: string;
  network: Network;
  /** The connected Arkade SDK wallet (`ArkadeWdkAdapter.rawWallet`); throws or returns null when disconnected. */
  wallet: () => any;
  arkServerUrl: () => string | undefined;
  /** The Ark server's network name (getInfo().network), for the solver registry. */
  arkNetwork: () => string | undefined;
  /** Fee for the Ark transaction that funds the lockup; null when unknown. */
  fundingFee: () => number | null;
  /** Spendable Arkade balance in sats; null when unreadable. */
  balance: () => Promise<number | null>;
  /** KaleidoSwap maker /v2 base URL (from the RGB network config), if configured. */
  makerUrl?: string | null;
  registryUrl?: string;
  store?: ArkadeSwapStore;
  fetchImpl?: typeof fetch;
}

interface Approval { providerId: string; facts: InvoiceFacts; terms: string; fundingFee: number }
interface AttemptRef { rfqId: string; providerId: string; fundAmountSats: number; fundingTxid?: string }

export function resultOfPhase(phase: ArkadeSwapPhase | undefined, reference?: string): PaymentResult {
  switch (phase) {
    case 'settled': return { status: 'completed', reference };
    case 'refunded': case 'cancelled': case 'failed': return { status: 'failed', reference };
    case 'prepared': case 'funded': return { status: 'pending', reference };
    default: return { status: 'unknown', reference };
  }
}

export function createArkadeIntentsSwap(opts: ArkadeIntentsOptions) {
  const { network } = opts;
  const to = `ln:${network}`;
  const store = opts.store ?? arkadeIntentsStore;
  const fetchImpl = timedFetch(opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)));
  const providers = createProviderSource(
    { network, arkNetwork: opts.arkNetwork, makerUrl: opts.makerUrl, registryUrl: opts.registryUrl, fetchImpl },
    isLightningSendMarket, 'KaleidoSwap does not offer Arkade → Lightning right now.',
  );
  const approved = new WeakMap<Quote, Approval>();
  const attemptKey = (attemptId: string) => `kaleidopay-arkade-ln-${opts.sourceId}-${attemptId}`;

  function check(preview: Preview, route: Route): InvoiceFacts {
    if (route.kind !== 'swap' || route.to !== to || route.sourceId !== opts.sourceId || route.providerId !== ARKADE_INTENTS_SWAP_ID) {
      throw new Error('This account pays Lightning only through an Arkade Intents swap.');
    }
    if (!preview.code.invoice) throw new Error('Arkade swaps pay Lightning invoices (BOLT11), not offers.');
    const facts = invoiceFacts(preview.code.invoice);
    if (facts.amountSats !== preview.request.amountSat) throw new Error('The invoice asks for a different amount than this payment.');
    if (facts.expiresAt <= Math.floor(Date.now() / 1000) + INVOICE_MARGIN_S) throw new Error('The Lightning invoice has expired or expires too soon.');
    return facts;
  }
  const terms = (preview: Preview, route: Route) => JSON.stringify({ request: preview.request, invoice: preview.code.invoice, route });

  async function quoteOptions(preview: Preview, route: Route): Promise<AccountQuoteOption[]> {
    const facts = check(preview, route);
    const fundingFee = opts.fundingFee();
    const list = await providers();
    if (!list.length) throw new Error('No Arkade swap provider pays Lightning on this network right now.');
    const balance = await opts.balance().catch(() => null);
    const expiresAt = Math.min(Math.floor(Date.now() / 1000) + QUOTE_TTL_S, facts.expiresAt - INVOICE_MARGIN_S);
    return list.map(p => {
      const option: AccountQuoteOption = { id: p.id, name: p.name, detail: 'detail' in p ? p.detail : undefined };
      if (!('market' in p)) { option.unavailable = p.unavailable; return option; }
      if (fundingFee === null) { option.unavailable = 'Arkade did not report its transaction fee, so a complete quote is not available.'; return option; }
      const estimate = estimateLightningSend(p.market, preview.request.amountSat);
      if ('unavailable' in estimate) { option.unavailable = estimate.unavailable; return option; }
      const feeSat = estimate.feeSat + fundingFee;
      const totalSat = preview.request.amountSat + feeSat;
      if (balance === null) { option.unavailable = 'Could not read your Arkade balance.'; return option; }
      if (totalSat > balance) { option.unavailable = `Insufficient Arkade balance (${totalSat.toLocaleString()} sats needed).`; return option; }
      option.detail = `${p.detail} · estimated from the provider's published fee; the final price is confirmed before paying and never exceeds this total`;
      option.quote = { recipientSat: preview.request.amountSat, feeSat, totalSat, expiresAt, estimatedSeconds: 30 };
      approved.set(option.quote, { providerId: p.id, facts, terms: terms(preview, route), fundingFee });
      return option;
    });
  }

  /** One reconcile pass over every stored swap; the transport is never used by reconcile. */
  let recovery: { venue: ArkadeIntentsVenue; wallet: any } | null = null;
  function recoveryVenue(): ArkadeIntentsVenue | null {
    let wallet: any;
    try { wallet = opts.wallet(); } catch { return null; }
    const arkServerUrl = opts.arkServerUrl();
    if (!wallet || !arkServerUrl) return null;
    const current = recovery as { venue: ArkadeIntentsVenue; wallet: any } | null;
    if (current && current.wallet === wallet) return current.venue;
    const venue = new (load().venue.ArkadeIntentsVenue)({ wallet, arkServerUrl, store, transport: idleTransport });
    recovery = { wallet, venue };
    return venue;
  }
  let reconciling: Promise<ReconcileReport | null> | null = null;
  function reconcile(): Promise<ReconcileReport | null> {
    reconciling ??= (async () => {
      const venue = recoveryVenue();
      return venue ? venue.reconcile() : null;
    })().catch(() => null).finally(() => { reconciling = null; });
    return reconciling;
  }

  async function execute(preview: Preview, route: Route, quote: Quote, attemptId: string): Promise<PaymentResult> {
    const prior = await AsyncStorage.getItem(attemptKey(attemptId));
    if (prior) return status(attemptId); // never fund an attempt twice
    let approval: Approval, facts: InvoiceFacts, provider: IntentsProvider, wallet: any, arkServerUrl: string;
    try {
      approval = approved.get(quote)!;
      if (!approval || approval.terms !== terms(preview, route)) throw new Error('Review the payment again to get a fresh quote.');
      facts = check(preview, route);
      if (quote.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('Review the payment again to get a fresh quote.');
      const listed = (await providers()).find(p => p.id === approval.providerId);
      if (!listed || !('market' in listed)) throw new Error('That swap provider is no longer available. Choose another way to pay.');
      provider = listed;
      wallet = opts.wallet();
      arkServerUrl = opts.arkServerUrl()!;
      if (!wallet || !arkServerUrl) throw new Error('Arkade is not connected.');
    } catch (error) {
      throw new PaymentNotSentError(error instanceof Error ? error.message : 'Review the payment again.');
    }
    approved.delete(quote);

    const transport = provider.transport();
    try {
      const venue = new (load().venue.ArkadeIntentsVenue)({ wallet, arkServerUrl, store, transport });
      // The one binding RFQ. It persists its recovery record before returning; nothing is funded yet.
      let prepared: Awaited<ReturnType<ArkadeIntentsVenue['prepareLightningSend']>>;
      try { prepared = await venue.prepareLightningSend({ invoice: facts }); }
      catch (error) {
        throw new PaymentNotSentError(`${provider.name} did not give a usable quote (${error instanceof Error ? error.message : 'no answer'}). Choose another way to pay.`);
      }
      const now = Math.floor(Date.now() / 1000);
      const spend = prepared.fundAmountSats + approval.fundingFee;
      if (prepared.summary.toAmountSats !== quote.recipientSat || prepared.fundAmountSats !== prepared.summary.fromAmountSats) {
        throw new PaymentNotSentError('The provider quoted a different payment. Nothing was sent.');
      }
      if (spend > quote.totalSat!) {
        throw new PaymentNotSentError(`${provider.name} now asks ${spend.toLocaleString()} sats, more than the ${quote.totalSat!.toLocaleString()} you approved. Nothing was sent.`);
      }
      if (prepared.summary.validUntil <= now + 5) throw new PaymentNotSentError('The provider quote expired before paying. Nothing was sent.');
      const balance = await opts.balance().catch(() => null);
      if (balance === null || spend > balance) throw new PaymentNotSentError('Insufficient Arkade balance. Nothing was sent.');

      // Recovery data first: the venue record is already stored; link it to this attempt.
      const ref: AttemptRef = { rfqId: prepared.record.id, providerId: provider.id, fundAmountSats: prepared.fundAmountSats };
      await AsyncStorage.setItem(attemptKey(attemptId), JSON.stringify(ref));
      // Funding is the acceptance. Past this point a failure may have moved funds: it is not "not sent".
      const txid: string = await wallet.sendBitcoin({ address: prepared.address, amount: prepared.fundAmountSats });
      if (!txid) return { status: 'unknown', reference: prepared.record.id };
      await AsyncStorage.setItem(attemptKey(attemptId), JSON.stringify({ ...ref, fundingTxid: txid }));
      // A lost notify self-heals: reconcile finds the funded lockup from chain evidence.
      await venue.notifyFunded(prepared.record.id, txid).catch(() => undefined);
      return { status: 'pending', reference: prepared.record.id };
    } finally {
      void transport.close().catch(() => undefined);
    }
  }

  async function status(attemptId: string): Promise<PaymentResult> {
    const raw = await AsyncStorage.getItem(attemptKey(attemptId));
    if (!raw) return { status: 'unknown' };
    let ref: AttemptRef;
    try { ref = JSON.parse(raw); } catch { return { status: 'unknown' }; }
    let record = await store.get(ref.rfqId);
    if (record && (record.phase === 'prepared' || record.phase === 'funded')) {
      await reconcile();
      record = await store.get(ref.rfqId);
    }
    if (!record) return { status: 'unknown', reference: ref.rfqId };
    // Funded but not yet notified reads as prepared; with a funding txid it is in flight.
    if (record.phase === 'prepared' && !ref.fundingTxid) return { status: 'unknown', reference: ref.rfqId };
    return resultOfPhase(record.phase, record.phase === 'settled' ? record.resolvedTxid ?? ref.rfqId : ref.rfqId);
  }

  const swaps: SwapCapability[] = [{ id: ARKADE_INTENTS_SWAP_ID, from: opts.rail, to, network }];
  return {
    swaps,
    providerNames: { [ARKADE_INTENTS_SWAP_ID]: 'Arkade Intents (Lightning)' },
    quoteOptions,
    execute,
    status,
    /** Runs one reconcile pass over stored swaps (claims, refunds, cancellations). Never pays. */
    recover: reconcile,
  };
}

/** Reconcile never negotiates, so the recovery venue gets a transport that refuses to. */
const idleTransport: RfqTransport = {
  requestQuote: async () => { throw new Error('recovery venue does not quote'); },
  status: async () => null,
  close: async () => undefined,
};

/**
 * Finishes Arkade Intents swaps a restart interrupted: one reconcile pass over the
 * persistent store. Never funds anything; safe to call on every start.
 */
export async function recoverArkadeIntentSwaps(wallet: any, arkServerUrl: string, store: ArkadeSwapStore = arkadeIntentsStore): Promise<ReconcileReport | null> {
  if (!wallet || !arkServerUrl) return null;
  if (!(await store.listPending()).length) return null;
  const venue = new (load().venue.ArkadeIntentsVenue)({ wallet, arkServerUrl, store, transport: idleTransport });
  return venue.reconcile();
}

// ---------------------------------------------------------------------------
// Lightning -> Arkade: receive a Lightning payment into Arkade. A provider's hold
// invoice is shown to the sender; once it is paid the provider locks the sats on
// Arkade and the wallet claims them (revealing the preimage settles the invoice).
// ---------------------------------------------------------------------------
export interface ArkadeLightningReceiveOptions {
  network: Network;
  /** The connected Arkade SDK wallet (`ArkadeWdkAdapter.rawWallet`). */
  wallet: any;
  arkServerUrl: string;
  /** The Ark server's network name (getInfo().network), for the solver registry. */
  arkNetwork?: string;
  makerUrl?: string | null;
  registryUrl?: string;
  store?: ArkadeSwapStore;
  fetchImpl?: typeof fetch;
}

export interface ArkadeLightningReceive {
  rfqId: string;
  /** The invoice the sender pays. */
  invoice: string;
  /** What lands on Arkade, sats. */
  amountSats: number;
  /** What the sender pays, sats (amount plus the provider's fee). */
  payAmountSats: number;
  provider: string;
  /** Invoice expiry, unix seconds. */
  expiresAt: number;
}

/** Headroom over the card estimate a binding quote may use before it is refused. */
const receiveFeeCap = (estimate: number, amountSats: number) => estimate + Math.ceil(amountSats * 0.005) + 10;

/**
 * Ask the providers in order (KaleidoSwap first) for a Lightning invoice that pays
 * `amountSats` into this Arkade wallet. Each attempt is a real RFQ; the first provider
 * that quotes within its published fee wins. Nothing is spent by the wallet.
 */
export async function createArkadeLightningReceive(opts: ArkadeLightningReceiveOptions, amountSats: number): Promise<ArkadeLightningReceive> {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('Set an amount: Lightning into Arkade needs one.');
  if (!opts.wallet || !opts.arkServerUrl) throw new Error('Arkade is not connected.');
  const fetchImpl = timedFetch(opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)));
  const providers = createProviderSource(
    { network: opts.network, arkNetwork: () => opts.arkNetwork, makerUrl: opts.makerUrl, registryUrl: opts.registryUrl, fetchImpl },
    isLightningReceiveMarket, 'KaleidoSwap does not offer Lightning → Arkade right now.',
  );
  const list = await providers();
  const reasons: string[] = [];
  for (const provider of list) {
    if (!('market' in provider)) { reasons.push(`${provider.name}: ${provider.unavailable}`); continue; }
    const estimate = estimateLightningReceive(provider.market, amountSats);
    if ('unavailable' in estimate) { reasons.push(`${provider.name}: ${estimate.unavailable}`); continue; }
    const transport = provider.transport();
    try {
      const venue = new (load().venue.ArkadeIntentsVenue)({
        wallet: opts.wallet, arkServerUrl: opts.arkServerUrl, store: opts.store ?? arkadeIntentsStore, transport,
      });
      const prepared = await venue.prepareLightningReceive({
        amountSats,
        decodeInvoice: invoiceFacts,
        maxPayAmountSats: receiveFeeCap(estimate.payAmountSat, amountSats),
      });
      if (prepared.summary.toAmountSats !== amountSats) {
        reasons.push(`${provider.name}: quoted a different amount`);
        continue;
      }
      return {
        rfqId: prepared.record.id, invoice: prepared.invoice, amountSats,
        payAmountSats: prepared.payAmountSats, provider: provider.name, expiresAt: prepared.invoiceExpiresAt,
      };
    } catch (error) {
      reasons.push(`${provider.name}: ${error instanceof Error ? error.message : 'no answer'}`);
    } finally {
      void transport.close().catch(() => undefined);
    }
  }
  throw new Error(list.length
    ? `No swap provider could give a Lightning invoice into Arkade. ${reasons.join(' · ')}`
    : 'No swap provider receives Lightning into Arkade on this network right now.');
}

const claimVenues = new WeakMap<object, ArkadeIntentsVenue>();
/**
 * One claim pass for a Lightning receive: claims the provider's Arkade lockup once it
 * is funded. Safe to call repeatedly; never pays. Returns the swap's phase.
 */
export async function claimArkadeLightningReceive(
  wallet: any, arkServerUrl: string, rfqId: string, store: ArkadeSwapStore = arkadeIntentsStore,
): Promise<ArkadeSwapPhase | undefined> {
  if (!wallet || !arkServerUrl) return undefined;
  let venue = claimVenues.get(wallet);
  if (!venue) {
    venue = new (load().venue.ArkadeIntentsVenue)({ wallet, arkServerUrl, store, transport: idleTransport });
    claimVenues.set(wallet, venue);
  }
  const record = await venue.claimReceive(rfqId, { waitSeconds: 0 });
  return record?.phase;
}
