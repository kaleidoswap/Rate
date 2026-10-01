import { acceptedRails, decodePaymentCode, planPayment } from '@universal-bolt12/universal-code';
import type { Network, PaymentCode, PaymentRequest, Plan, Route, SwapCapability, WalletSource } from '@universal-bolt12/universal-code';
export type { Network } from '@universal-bolt12/universal-code';
import type { SwapAttempt } from '@universal-bolt12/swap-market';
export type { SwapAttempt } from '@universal-bolt12/swap-market';

export interface Preview { code: PaymentCode; request: PaymentRequest; plan: Plan }
export interface Quote { recipientSat: number; totalSat: number; feeSat: number; expiresAt: number }
export interface PayAccount {
  source: WalletSource;
  swaps: SwapCapability[];
  // Must validate offer semantics, chain, expiry and authenticated invoice terms before quoting.
  quote: (preview: Preview, route: Route) => Promise<Quote>;
  /** Executes an approved quote; must persist recovery material before funding. */
  pay?: (preview: Preview, route: Route, quote: Quote, onUpdate?: (attempt: SwapAttempt) => void) => Promise<SwapAttempt>;
}
const accounts = new Map<string, PayAccount>();
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
export async function quotePayment(preview: Preview): Promise<Quote> {
  if (preview.plan.status !== 'ready') throw new Error('No connected account supports this payment.');
  const route = preview.plan.route;
  const account = accounts.get(route.sourceId);
  if (!account || account.source.network !== preview.request.network) throw new Error('Account disconnected. Review the request again.');
  const currentPlan = planPayment(preview.request, [account.source], account.swaps);
  if (currentPlan.status !== 'ready' || ![currentPlan.route, ...currentPlan.alternatives].some(r => JSON.stringify(r) === JSON.stringify(route))) {
    throw new Error('Account capabilities changed. Review the request again.');
  }
  const quote = await account.quote(preview, route);
  if (accounts.get(route.sourceId) !== account) throw new Error('Account disconnected. Review the request again.');
  if (![quote.recipientSat, quote.totalSat, quote.feeSat, quote.expiresAt].every(Number.isSafeInteger)
    || quote.recipientSat !== preview.request.amountSat || quote.feeSat < 0
    || quote.totalSat !== quote.recipientSat + quote.feeSat || quote.totalSat > 2100000000000000
    || quote.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('The payment quote is invalid or expired.');
  return quote;
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
