import type { SwapAttempt } from '@universal-bolt12/swap-market';
export type { SwapAttempt } from '@universal-bolt12/swap-market';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { acceptedRails, decodePaymentCode, planPayment } from '@universal-bolt12/universal-code';
import type { Network, PaymentCode, PaymentRequest, Plan, Route, SwapCapability, WalletSource } from '@universal-bolt12/universal-code';
export type { Network, Route } from '@universal-bolt12/universal-code';

export interface Preview { code: PaymentCode; request: PaymentRequest; plan: Plan }
export interface SpendAsset { id: string; ticker: string; precision: number }
export interface SpendQuote { asset: SpendAsset; amount: number; fee: number; total: number }
export interface Quote {
  recipientSat: number; expiresAt: number;
  totalSat?: number; feeSat?: number;
  spend?: SpendQuote;
  estimatedSeconds?: number;
}
export interface PaymentResult { status: 'completed' | 'pending' | 'unknown' | 'failed'; reference?: string }
export interface AccountQuoteOption { id: string; name: string; quote?: Quote; unavailable?: string }
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
  id: string; provider: string; accountName: string; route: Route;
  quote?: Quote; unavailable?: string; executable: boolean;
}
const accounts = new Map<string, PayAccount>();
const owners = new WeakMap<PaymentOffer, { account: PayAccount; snapshot: string }>();
export function registerKaleidoPayAccount(account: PayAccount): () => void {
  accounts.set(account.source.id, account);
  return () => { if (accounts.get(account.source.id) === account) accounts.delete(account.source.id); };
}
export function isKaleidoPayCode(text: string): boolean {
  return /^lno1/i.test(text.trim()) || /^bitcoin:/i.test(text.trim()) && /[?&]lno=/i.test(text);
}
export function previewPayment(text: string, network: Network, amount: string, requestId: string): Preview {
  const code = decodePaymentCode(text.trim(), network);
  if (code.amountSat === undefined && !/^[1-9]\d*$/.test(amount)) throw new Error('Enter a whole number of sats.');
  const amountSat = code.amountSat ?? Number(amount);
  const rails = [...(code.address ? [`btc:${network}`] : []), ...(code.offer ? acceptedRails(code.offer) : [])];
  const request: PaymentRequest = { id: requestId, network, amountSat, acceptedRails: [...new Set(rails)] };
  const available = [...accounts.values()].filter(a => a.source.network === network);
  const plan = planPayment(request, available.map(a => a.source), available.flatMap(a => a.swaps));
  return { code, request, plan };
}
export function quoteSpend(quote: Quote): SpendQuote {
  return quote.spend ?? { asset: { id: 'BTC', ticker: 'sats', precision: 0 }, amount: quote.recipientSat, fee: quote.feeSat!, total: quote.totalSat! };
}
export function formatSpend(value: number, asset: SpendAsset): string {
  return `${(value / 10 ** asset.precision).toLocaleString(undefined, { maximumFractionDigits: asset.precision })} ${asset.ticker}`;
}
function getAccount(preview: Preview, route: Route) {
  const account = accounts.get(route.sourceId);
  if (!account || account.source.network !== preview.request.network) throw new Error('Account disconnected. Review the request again.');
  const plan = planPayment(preview.request, [account.source], account.swaps);
  if (plan.status !== 'ready' || ![plan.route, ...plan.alternatives].some(r => JSON.stringify(r) === JSON.stringify(route))) throw new Error('Account capabilities changed. Review the request again.');
  return account;
}
function validateQuote(quote: Quote, preview: Preview, account: PayAccount) {
  const spend = quoteSpend(quote);
  const asset = account.spendAsset ?? { id: 'BTC', ticker: 'sats', precision: 0 };
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
        const offer: PaymentOffer = { ...base, id: choice.id ? `${base.id}:${choice.id}` : base.id, provider: choice.name, quote: choice.quote, unavailable: choice.unavailable };
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
export class PaymentNotSentError extends Error {}
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
    try { return normalizeResult(await account.execute!(preview, offer.route, offer.quote!, attemptId)); }
    catch { return { status: 'unknown' }; }
  })();
  executions.set(key, execution);
  try { return await execution; } finally { executions.delete(key); }
  } catch (error) {
    // Executor errors are normalized to unknown above. Anything reaching here
    // failed before handing a payment to the provider.
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
  if (!account || account.source.network !== preview.request.network) throw new Error('Account disconnected. Review the request again.');
  if (!account.pay) throw new Error('This account can quote but not pay yet.');
  return account.pay(preview, route, quote, onUpdate);
}

export { createElectrumSwapAccount, resumeKaleidoPaySwaps } from './electrumSwapAccount';
export { createAttemptStore, secureSecretStore } from './storage';
export { kaleidoPayAttempts, kaleidoPayStores, recoverKaleidoPaySwaps } from './recovery';
