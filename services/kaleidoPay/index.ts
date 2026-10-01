import { acceptedRails, decodePaymentCode, planPayment } from './universalCode';
import type { Network, PaymentCode, PaymentRequest, Plan, Route, SwapCapability, WalletSource } from './universalCode';
export type { Network } from './universalCode';

export interface Preview { code: PaymentCode; request: PaymentRequest; plan: Plan }
export interface Quote { recipientSat: number; totalSat: number; feeSat: number; expiresAt: number }
export interface PayAccount {
  source: WalletSource;
  swaps: SwapCapability[];
  // Must validate offer semantics, chain, expiry and authenticated invoice terms before quoting.
  quote: (preview: Preview, route: Route) => Promise<Quote>;
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
