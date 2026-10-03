import type { SwapAttempt } from '@universal-bolt12/swap-market';
export type { SwapAttempt } from '@universal-bolt12/swap-market';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decodeBolt11 } from '../../utils/decodeInvoice';
import { resolveLightningAddressToInvoice } from '../../utils/lnurl';
import { decodeTarget, targetOfferRails, TEST_NETWORKS, bitcoinAddressNetworks } from './target';
import type { ChainNetwork, PayTarget } from './target';
export { decodeTarget, offerAmountSat } from './target';
export type { ChainNetwork, PayTarget, TargetKind } from './target';

/** A chain an account or request is on. */
export type Network = ChainNetwork;
/** For an RGB payment: the asset and amount (in base units) the recipient asks for. */
export interface RequestAsset { id: string; ticker: string; precision: number; amount: number }
export interface PaymentRequest {
  id: string;
  /** The network shown for the request; `networks` lists every one it may be on. */
  network: Network;
  networks: Network[];
  /** Sats the recipient receives; 0 for an RGB asset payment (see `asset`). */
  amountSat: number;
  /** Rails the recipient accepts, in their order of preference. */
  acceptedRails: string[];
  asset?: RequestAsset;
}
export interface WalletSource { id: string; rail: string; network: Network }
export interface SwapCapability { id: string; from: string; to: string; network: Network }
export type Route = { kind: 'direct' | 'swap'; sourceId: string; from: string; to: string; providerId?: string };
export type Plan = { status: 'ready'; requestId: string; route: Route; alternatives: Route[] }
  | { status: 'unsupported'; requestId: string; reason: string };

/** `addresses`: the receiver's address per rail, for rails it is paid on directly (Bark, Arkade). */
export interface Preview { code: PayTarget; request: PaymentRequest; plan: Plan; addresses: Record<string, string> }
export interface SpendAsset { id: string; ticker: string; precision: number }
export interface SpendQuote { asset: SpendAsset; amount: number; fee: number; total: number }
export interface Quote {
  recipientSat: number; expiresAt: number;
  totalSat?: number; feeSat?: number;
  spend?: SpendQuote;
  estimatedSeconds?: number;
}
export interface PaymentResult { status: 'completed' | 'pending' | 'unknown' | 'failed'; reference?: string }
export interface AccountQuoteOption { id: string; name: string; detail?: string; quote?: Quote; unavailable?: string }
export interface PayAccount {
  pay?: (preview: Preview, route: Route, quote: Quote, onUpdate?: (attempt: SwapAttempt) => void) => Promise<SwapAttempt>;
  source: WalletSource;
  name?: string;
  spendAsset?: SpendAsset;
  providerNames?: Record<string, string>;
  swaps: SwapCapability[];
  // Quote must validate destination, amount, network, offer signature/expiry and liquidity.
  quote: (preview: Preview, route: Route) => Promise<Quote>;
  quoteOptions?: (preview: Preview, route: Route) => Promise<AccountQuoteOption[]>;
  // Implementations must enforce the accepted quote, persist recovery data BEFORE
  // funding, and deduplicate attemptId. Never pay while generating a quote.
  execute?: (preview: Preview, route: Route, quote: Quote, attemptId: string) => Promise<PaymentResult>;
  status?: (attemptId: string) => Promise<PaymentResult>;
}
export interface PaymentOffer {
  id: string; provider: string; providerDetail?: string; accountName: string; route: Route;
  quote?: Quote; unavailable?: string; executable: boolean;
}
/** Development builds with EXPO_PUBLIC_KALEIDOPAY_DEMO=1 simulate only the final payment; quotes stay live and
 *  the screen says so. Never in a release build: a simulated "completed" there would look like a real payment. */
export const KALEIDOPAY_DEMO = typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_KALEIDOPAY_DEMO === '1';
const accounts = new Map<string, PayAccount>();
const owners = new WeakMap<PaymentOffer, { account: PayAccount; snapshot: string }>();
const preparers = new Set<() => Promise<void>>();
/** An account that needs async setup before it can route (e.g. a server key) registers here. */
export function registerKaleidoPayPreparer(prepare: () => Promise<void>): () => void {
  preparers.add(prepare);
  return () => { preparers.delete(prepare); };
}
/** Run before previewing a payment; never throws, waits at most 8 s. */
export async function prepareKaleidoPay(): Promise<void> {
  await Promise.race([Promise.allSettled([...preparers].map(p => p())), new Promise(r => setTimeout(r, 8000))]);
}
export function registerKaleidoPayAccount(account: PayAccount): () => void {
  accounts.set(account.source.id, account);
  return () => { if (accounts.get(account.source.id) === account) accounts.delete(account.source.id); };
}

// ---------------------------------------------------------------------------
// Planning. A rail is either network-bound (`btc`, `ln`, `spark`, `rgb`,
// `ark`, optionally suffixed with a network) or keyed to one server (`bark:<key>`,
// `arkade:<key>`). Accounts and swaps name their own network; a request lists the
// networks it may be on, so a test-network code reaches accounts on any test chain.
// ---------------------------------------------------------------------------
const NETWORK_BOUND = /^(btc|ln|rgb-ln|rgb|spark|ark)(?::(mainnet|signet|mutinynet|testnet|regtest))?$/;
const railBase = (rail: string) => NETWORK_BOUND.exec(rail)?.[1];
/** A rail as seen from an account on `network`: network-bound rails get that network. */
function onNetwork(rail: string, network: Network): string {
  const base = railBase(rail);
  return base ? `${base}:${network}` : rail;
}

/** Capability planning only: no liquidity, quote, balance or invoice verification is implied. */
export function planRoutes(request: PaymentRequest, sources: WalletSource[], swaps: SwapCapability[] = []): Plan {
  const direct: Route[] = [], routed: Route[] = [];
  for (const rail of request.acceptedRails) {
    const railNetwork = NETWORK_BOUND.exec(rail)?.[2] as Network | undefined;
    for (const source of sources) {
      if (!request.networks.includes(source.network)) continue;
      if (railNetwork && railNetwork !== source.network) continue;
      const from = onNetwork(source.rail, source.network);
      const to = onNetwork(rail, source.network);
      if (from === to) direct.push({ kind: 'direct', sourceId: source.id, from, to });
      else for (const swap of swaps) {
        if (swap.network !== source.network) continue;
        if (onNetwork(swap.from, swap.network) === from && onNetwork(swap.to, swap.network) === to) {
          routed.push({ kind: 'swap', sourceId: source.id, from, to, providerId: swap.id });
        }
      }
    }
  }
  const routes = [...direct, ...routed].filter((r, i, all) => all.findIndex(x => JSON.stringify(x) === JSON.stringify(r)) === i);
  return routes.length ? { status: 'ready', requestId: request.id, route: routes[0], alternatives: routes.slice(1) }
    : { status: 'unsupported', requestId: request.id, reason: 'None of your connected accounts can pay this request.' };
}

const RAIL_LABELS: Record<string, string> = {
  bark: 'Bark', arkade: 'Arkade', ark: 'Ark', ln: 'Lightning', btc: 'On-chain',
  'rgb-ln': 'RGB Lightning', rgb: 'RGB', spark: 'Spark',
};
export function railLabel(rail: string): string {
  return RAIL_LABELS[rail.split(':')[0]] ?? rail;
}

export interface PreviewOptions {
  /** Restrict to these networks (e.g. the network a merchant QR names). */
  networks?: Network[];
  /** For RGB invoices: the asset and amount, decoded by the RGB account. */
  asset?: RequestAsset;
}
const ALL_NETWORKS: Network[] = ['mainnet', ...TEST_NETWORKS, 'regtest'];

/** Builds the request for a decoded target. `amountSat` is used when the target fixes none. */
export function previewTarget(target: PayTarget, amountSat: number | undefined, requestId: string, opts: PreviewOptions = {}): Preview {
  if (target.kind === 'lnurl') throw new Error('Enter an amount to pay this Lightning address.');
  if (!requestId || requestId.length > 128) throw new Error('Invalid request.');
  const asset = target.kind === 'rgb' ? opts.asset : undefined;
  if (target.kind === 'rgb' && (!asset || !Number.isSafeInteger(asset.amount) || asset.amount <= 0)) {
    throw new Error('Enter the asset amount to send.');
  }
  const fixed = target.amountSat;
  const amount = asset ? 0 : fixed ?? amountSat;
  if (!asset && (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0 || amount > 2100000000000000)) {
    throw new Error('Enter a whole number of sats.');
  }
  // The receiver's order: an offer's listed rails first, then what the code itself carries.
  const listed = targetOfferRails(target);
  const rails = [
    ...listed.map(r => r.rail),
    ...(target.invoice ? ['ln'] : []),
    ...(target.address ? ['btc'] : []),
    ...(target.sparkAddress ? ['spark'] : []),
    ...(target.arkAddress ? ['ark'] : []),
    ...(target.rgbInvoice ? ['rgb'] : []),
  ];
  const addresses: Record<string, string> = Object.fromEntries(listed.flatMap(r => r.address ? [[r.rail, r.address]] : []));
  if (target.arkAddress) addresses.ark = target.arkAddress;
  const networks = (opts.networks ?? target.networks ?? ALL_NETWORKS).filter(n => !target.networks || target.networks.includes(n));
  if (!networks.length) throw new Error('This request is for a different network.');
  const request: PaymentRequest = {
    id: requestId, network: networks[0], networks, amountSat: amount!,
    acceptedRails: [...new Set(rails)], ...(asset ? { asset } : {}),
  };
  if (!request.acceptedRails.length) throw new Error('This request has nothing to pay.');
  const available = [...accounts.values()];
  const plan = planRoutes(request, available.map(a => a.source), available.flatMap(a => a.swaps));
  return { code: target, request, plan, addresses };
}

/**
 * Decodes whatever the user entered and builds its request. A Lightning address or LNURL
 * is resolved to an invoice for `amountSat`, which must then ask for exactly that amount.
 */
export async function previewInput(text: string, amountSat: number | undefined, requestId: string, opts: PreviewOptions = {}): Promise<Preview> {
  let target = decodeTarget(text);
  if (target.kind === 'lnurl') {
    if (amountSat === undefined || !Number.isSafeInteger(amountSat) || amountSat <= 0) throw new Error('Enter an amount to pay this Lightning address.');
    const invoice = await resolveLightningAddressToInvoice(target.lnurl!, amountSat);
    const decoded = decodeBolt11(invoice);
    if (decoded.amountSats !== amountSat) throw new Error('The Lightning address returned an invoice for a different amount.');
    target = { ...decodeTarget(invoice), raw: target.raw, lnurl: target.lnurl };
  }
  return previewTarget(target, amountSat, requestId, opts);
}

/** Networks a code says it is for (undefined when it doesn't say); never throws on a half-typed code. */
export function codeNetworks(text: string): Network[] | undefined {
  try { return decodeTarget(text).networks; } catch { return undefined; }
}
/** The single network a code is for, when it names exactly one. */
export function codeNetwork(text: string): Network | undefined {
  const networks = codeNetworks(text);
  return networks?.length === 1 ? networks[0] : undefined;
}
/** Anything Send can pay (used to decide when typed text is complete enough to review). */
export function isPayable(text: string): boolean {
  try { decodeTarget(text); return true; } catch { return false; }
}

// Kept for callers that still route only universal codes here.
export function isKaleidoPayCode(text: string): boolean {
  const code = text.trim().replace(/^lightning:(\/\/)?/i, '').trim();
  return /^lno1/i.test(code) || /^bitcoin:/i.test(code) && /[?&]lno=/i.test(code);
}
/** A valid (checksummed) non-regtest bitcoin address, or a BIP21 with only amount/label/message. */
export function isSwappableAddress(text: string): boolean {
  const code = text.trim().replace(/^lightning:(\/\/)?/i, '').trim();
  const query = /^bitcoin:/i.test(code) ? code.split('?')[1] ?? '' : '';
  if (query.split('&').filter(Boolean).some(p => !['amount', 'label', 'message'].includes(p.split('=')[0].toLowerCase()))) return false;
  try {
    const t = decodeTarget(code);
    const networks = t.kind === 'bitcoin' && t.address ? bitcoinAddressNetworks(t.address) : null;
    return !!networks && !networks.includes('regtest');
  } catch { return false; }
}

/** Legacy entry point: decode a universal code for one known network. */
export function previewPayment(text: string, network: Network, amount: string, requestId: string): Preview {
  const target = decodeTarget(text);
  if (target.amountSat === undefined && !/^[1-9]\d*$/.test(amount)) throw new Error('Enter a whole number of sats.');
  // The caller names the network explicitly (as before), so it overrides what the code implies.
  return previewTarget({ ...target, networks: undefined }, target.amountSat ?? Number(amount), requestId, { networks: [network] });
}
export function quoteSpend(quote: Quote): SpendQuote {
  return quote.spend ?? { asset: { id: 'BTC', ticker: 'sats', precision: 0 }, amount: quote.recipientSat, fee: quote.feeSat!, total: quote.totalSat! };
}
export function formatSpend(value: number, asset: SpendAsset): string {
  return `${(value / 10 ** asset.precision).toLocaleString(undefined, { maximumFractionDigits: asset.precision })} ${asset.ticker}`;
}
function getAccount(preview: Preview, route: Route) {
  const account = accounts.get(route.sourceId);
  if (!account || !preview.request.networks.includes(account.source.network)) throw new Error('Account disconnected. Review the request again.');
  const plan = planRoutes(preview.request, [account.source], account.swaps);
  if (plan.status !== 'ready' || ![plan.route, ...plan.alternatives].some(r => JSON.stringify(r) === JSON.stringify(route))) throw new Error('Account capabilities changed. Review the request again.');
  return account;
}
function validateQuote(quote: Quote, preview: Preview, account: PayAccount) {
  const spend = quoteSpend(quote);
  const asset = account.spendAsset ?? { id: 'BTC', ticker: 'sats', precision: 0 };
  const requested = preview.request.asset;
  // An RGB payment is checked in the asset's base units; a bitcoin payment in sats.
  if (requested && (!quote.spend || spend.asset.id !== requested.id || spend.amount !== requested.amount)) {
    throw new Error('The payment quote is for a different asset or amount.');
  }
  if (![quote.recipientSat, quote.expiresAt, spend.amount, spend.fee, spend.total].every(Number.isSafeInteger)
    || quote.recipientSat !== preview.request.amountSat || spend.amount <= 0 || spend.fee < 0
    || spend.total !== spend.amount + spend.fee || !Number.isSafeInteger(spend.amount + spend.fee)
    || spend.asset.id !== asset.id || spend.asset.ticker !== asset.ticker || spend.asset.precision !== asset.precision
    || !Number.isInteger(asset.precision) || asset.precision < 0 || asset.precision > 18
    || quote.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('The payment quote is invalid or expired.');
  if (!quote.spend && quote.totalSat! > 2100000000000000) throw new Error('The payment quote is invalid.');
}
export async function quotePayment(preview: Preview, selectedRoute?: Route): Promise<Quote> {
  if (preview.plan.status !== 'ready') throw new Error('No connected account supports this payment.');
  const route = selectedRoute ?? preview.plan.route;
  const account = getAccount(preview, route);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const quote = await Promise.race([
      account.quote(preview, route),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider did not respond. Try refreshing quotes.')), 15000); }),
    ]);
    if (accounts.get(route.sourceId) !== account) throw new Error('Account disconnected. Review the request again.');
    validateQuote(quote, preview, account);
    return quote;
  } finally { if (timer) clearTimeout(timer); }
}
export async function quotePaymentOffers(preview: Preview): Promise<PaymentOffer[]> {
  if (preview.plan.status !== 'ready') return [];
  const routes = [preview.plan.route, ...preview.plan.alternatives];
  const groups = await Promise.all(routes.map(async route => {
    const account = accounts.get(route.sourceId);
    const base = {
      id: JSON.stringify(route), route,
      provider: route.providerId ? account?.providerNames?.[route.providerId] ?? route.providerId : 'Direct payment',
      accountName: account?.name ?? route.sourceId, executable: !!account?.execute,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      getAccount(preview, route);
      const choices: AccountQuoteOption[] = account?.quoteOptions
        ? await Promise.race([account.quoteOptions(preview, route), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider did not respond. Try refreshing quotes.')), 15000); })])
        : [{ id: '', name: base.provider, quote: await quotePayment(preview, route) }];
      if (!account || accounts.get(route.sourceId) !== account) throw new Error('Account disconnected. Refresh quotes.');
      return choices.map(choice => {
        const offer: PaymentOffer = { ...base, id: choice.id ? `${base.id}:${choice.id}` : base.id, provider: choice.name, providerDetail: choice.detail, quote: choice.quote, unavailable: choice.unavailable };
        try {
          if (offer.quote && !offer.unavailable) {
            validateQuote(offer.quote, preview, account);
            owners.set(offer, { account, snapshot: JSON.stringify({ preview, route, quote: offer.quote }) });
          } else offer.unavailable ||= 'Quote unavailable';
        } catch (error) { offer.quote = undefined; offer.unavailable = error instanceof Error ? error.message : 'Quote unavailable'; }
        return offer;
      });
    } catch (error) { return [{ ...base, unavailable: error instanceof Error ? error.message : 'Quote unavailable' }]; }
    finally { if (timer) clearTimeout(timer); }
  }));
  return groups.flat();
}
/** Rank only offers using the same spend asset. Selection is explicit in the UI. */
export function bestOffer(offers: PaymentOffer[]): PaymentOffer | undefined {
  const valid = offers.filter(o => o.quote && !o.unavailable && o.quote.expiresAt * 1000 > Date.now());
  if (!valid.length) return undefined;
  const asset = quoteSpend(valid[0].quote!).asset;
  if (valid.some(o => { const a = quoteSpend(o.quote!).asset; return a.id !== asset.id || a.precision !== asset.precision; })) return undefined;
  return valid.reduce((best, o) => quoteSpend(o.quote!).total < quoteSpend(best.quote!).total ? o : best);
}
const executions = new Map<string, Promise<PaymentResult>>();
const normalizeResult = (value: PaymentResult): PaymentResult => value && ['completed', 'pending', 'unknown', 'failed'].includes(value.status) ? value : { status: 'unknown' };
import { PaymentNotSentError } from './errors';
export { PaymentNotSentError };
export async function executePaymentOffer(preview: Preview, offer: PaymentOffer, attemptId: string): Promise<PaymentResult> {
  try {
  const owner = owners.get(offer);
  const account = getAccount(preview, offer.route);
  if (!owner || owner.account !== account || !offer.quote || !account.execute
    || owner.snapshot !== JSON.stringify({ preview, route: offer.route, quote: offer.quote })) throw new Error('The selected quote changed. Refresh and review again.');
  validateQuote(offer.quote, preview, account);
  if (!attemptId || attemptId.length > 128) throw new Error('Invalid payment attempt.');
  const key = `kaleidopay-execution-${offer.route.sourceId}-${attemptId}`;
  const existing = executions.get(key);
  if (existing) return existing;
  const execution = (async (): Promise<PaymentResult> => {
    // A persistent claim prevents retransmission after a timeout or application restart.
    if (await AsyncStorage.getItem(key)) return { status: 'unknown' };
    await AsyncStorage.setItem(key, 'started');
    // Recheck after asynchronous storage: connection, terms and deadline may have changed.
    if (accounts.get(offer.route.sourceId) !== account || owner.snapshot !== JSON.stringify({ preview, route: offer.route, quote: offer.quote })) throw new Error('Account or quote changed before payment.');
    getAccount(preview, offer.route);
    validateQuote(offer.quote!, preview, account);
    if (KALEIDOPAY_DEMO) { await new Promise(r => setTimeout(r, 2500)); return { status: 'completed', reference: 'simulated' }; }
    try { return normalizeResult(await account.execute!(preview, offer.route, offer.quote!, attemptId)); }
    catch (error) {
      // An executor that refused before sending says so; anything else may have reached the provider.
      if (error instanceof PaymentNotSentError) throw error;
      return { status: 'unknown' };
    }
  })();
  executions.set(key, execution);
  try { return await execution; } finally { executions.delete(key); }
  } catch (error) {
    // Executor errors are normalized to unknown above unless the executor refused
    // before sending. Anything reaching here failed before handing a payment to the provider.
    if (error instanceof PaymentNotSentError) throw error;
    throw new PaymentNotSentError(error instanceof Error ? error.message : 'Payment could not be started.');
  }
}
export async function checkPaymentStatus(sourceId: string, attemptId: string): Promise<PaymentResult> {
  const account = accounts.get(sourceId);
  if (!account?.status) return { status: 'unknown' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return normalizeResult(await Promise.race([account.status(attemptId), new Promise<PaymentResult>(resolve => { timer = setTimeout(() => resolve({ status: 'unknown' }), 15000); })]));
  } catch { return { status: 'unknown' }; }
  finally { if (timer) clearTimeout(timer); }
}

/** Pays a quote the user approved. Re-checks the account and expiry; the account persists before funding. */
export async function executePayment(preview: Preview, quote: Quote, onUpdate?: (attempt: SwapAttempt) => void): Promise<SwapAttempt> {
  if (preview.plan.status !== 'ready') throw new Error('No connected account supports this payment.');
  if (quote.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('The quote expired. Review the payment again.');
  const route = preview.plan.route;
  const account = accounts.get(route.sourceId);
  if (!account || !preview.request.networks.includes(account.source.network)) throw new Error('Account disconnected. Review the request again.');
  if (!account.pay) throw new Error('This account can quote but not pay yet.');
  return account.pay(preview, route, quote, onUpdate);
}

export { createElectrumSwapAccount, resumeKaleidoPaySwaps } from './electrumSwapAccount';
export { createAttemptStore, secureSecretStore } from './storage';
export { kaleidoPayAttempts, kaleidoPayStores, recoverKaleidoPaySwaps } from './recovery';
