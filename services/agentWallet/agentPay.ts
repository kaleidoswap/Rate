// The only way the assistant pays from the Agent wallet. Every payment is
// decoded from the invoice itself, checked against the spending rules, asked
// about when the rules say so, logged before it is sent and settled after.
// Any error refuses the payment.

import { decode } from 'light-bolt11-decoder';
import { evaluateSpend, normalizeService, type DenyCode } from './policy';
import type { AgentWalletStore } from './store';
import { preimageMatches } from '../../utils/payment-proofs';
import { withAgentWalletLock } from './lock';
import { reconcilePending } from './reconcile';

export { withAgentWalletLock };

export interface AgentPayWallet {
  network: string;
  balanceSats(): Promise<number>;
  quoteLightningFee(invoice: string): Promise<number | null>;
  payInvoice(invoice: string, maxFeeSats: number): Promise<{ id?: string; preimage?: string; feeSats?: number; status: 'confirmed' | 'pending' | 'failed' }>;
  /** Where a payment stands, by its Spark id or else its invoice. Throws when it can't be told. */
  paymentStatus(ref: { id?: string; invoice?: string }): Promise<PaymentLookup>;
}

export interface PaymentLookup {
  status: 'confirmed' | 'failed' | 'pending' | 'not_found';
  feeSats?: number;
  id?: string;
}

export interface AgentPayConfirmation {
  service: string;
  amountSats: number;
  feeSats: number;
  invoice: string;
  reason: string;
  why: string;
  /** What the daily and monthly limits leave, before this payment. */
  leftTodaySats: number;
  leftMonthSats: number;
}

export interface AgentPayRequest {
  invoice: string;
  /** The service the payment is for: the URL or host that asked for it. */
  service: string;
  /** What the assistant was doing, e.g. the tool name. */
  reason: string;
  /** Amount the service announced, when it announced one; must equal the invoice. */
  expectedSats?: number;
}

export interface AgentPayDeps {
  store: AgentWalletStore | null;
  wallet: AgentPayWallet | null;
  confirm?: (c: AgentPayConfirmation) => Promise<boolean>;
  now?: () => number;
}

export type AgentPayErrorCode =
  | DenyCode
  | 'disabled'
  | 'bad_invoice'
  | 'amount_mismatch'
  | 'amountless'
  | 'expired'
  | 'wrong_network'
  | 'declined'
  | 'payment_failed'
  | 'payment_pending'
  | 'bad_proof';

export type AgentPayResult =
  | { ok: true; preimage: string; amountSats: number; feeSats: number; entryId: string }
  | { ok: false; code: AgentPayErrorCode; reason: string };

/** Seconds an invoice must still be valid for when it is sent. */
export const MIN_EXPIRY_LEFT_SEC = 20;

export interface DecodedInvoice {
  amountSats?: number;
  paymentHash: string;
  expiresAt: number;
  network: 'mainnet' | 'regtest' | 'testnet' | 'signet';
}

export function decodeAgentInvoice(invoice: string): DecodedInvoice | null {
  try {
    const text = String(invoice ?? '').trim().toLowerCase();
    const prefix = text.match(/^ln(bcrt|bc|tbs|tb)/)?.[1];
    if (!prefix) return null;
    const d: any = decode(text);
    const sec = (n: string) => d.sections?.find((s: any) => s.name === n)?.value;
    const hash = String(sec('payment_hash') ?? '');
    const timestamp = Number(sec('timestamp'));
    if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(timestamp)) return null;
    const expiry = Number(sec('expiry') ?? 3600) || 3600;
    const msat = sec('amount');
    let amountSats: number | undefined;
    if (msat != null) {
      const n = Number(msat);
      if (!Number.isFinite(n) || n <= 0 || n % 1000 !== 0) return null;
      amountSats = n / 1000;
    }
    const network = prefix === 'bc' ? 'mainnet' : prefix === 'bcrt' ? 'regtest' : prefix === 'tbs' ? 'signet' : 'testnet';
    return { amountSats, paymentHash: hash, expiresAt: (timestamp + expiry) * 1000, network };
  } catch {
    return null;
  }
}

/** Upper bound on routing fees when the wallet can't quote one. */
export const fallbackMaxFee = (amountSats: number) => Math.max(5, Math.ceil(amountSats * 0.01));

const fail = (code: AgentPayErrorCode, reason: string): AgentPayResult => ({ ok: false, code, reason });
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'unknown error');

export function payFromAgentWallet(req: AgentPayRequest, deps: AgentPayDeps): Promise<AgentPayResult> {
  return withAgentWalletLock(() => payNow(req, deps).catch((e) => fail('payment_failed', `The payment could not be made: ${message(e)}`)));
}

async function payNow(req: AgentPayRequest, deps: AgentPayDeps): Promise<AgentPayResult> {
  const now = deps.now ?? Date.now;
  const { store, wallet } = deps;
  if (!store || !wallet || !(await store.isEnabled())) return fail('disabled', 'The Agent wallet is off. Turn it on in Settings, KaleidoMind.');

  const service = normalizeService(req.service);
  const invoice = String(req.invoice ?? '').trim();
  const decoded = decodeAgentInvoice(invoice);
  if (!service || !decoded) return fail('bad_invoice', 'The service sent an invoice that could not be read.');
  if (decoded.amountSats == null) return fail('amountless', 'The invoice has no amount, so the assistant will not pay it.');
  const amountSats = decoded.amountSats;
  if (req.expectedSats !== undefined && req.expectedSats !== amountSats) {
    return fail('amount_mismatch', `The service asked for ${req.expectedSats} sats but its invoice is for ${amountSats} sats.`);
  }
  if (decoded.network !== (wallet.network === 'mainnet' ? 'mainnet' : 'regtest')) {
    return fail('wrong_network', 'The invoice is for a different Bitcoin network.');
  }
  if (decoded.expiresAt - now() < MIN_EXPIRY_LEFT_SEC * 1000) return fail('expired', 'The invoice has expired. Ask the service again.');

  await reconcilePending(store, wallet, now()).catch(() => {});
  const policy = await store.loadPolicy();
  const totals = await store.totals(now());
  let feeSats = fallbackMaxFee(amountSats);
  try {
    const quoted = await wallet.quoteLightningFee(invoice);
    if (quoted != null && Number.isInteger(quoted) && quoted >= 0) feeSats = quoted;
  } catch { /* keep the fallback bound */ }
  const balance = await wallet.balanceSats();
  const decision = evaluateSpend(policy, totals, { amountSats, feeSats, service }, balance);
  const reason = String(req.reason ?? '').slice(0, 80) || 'assistant';

  if (decision.kind === 'deny') {
    await store.add({ kind: 'spend', amountSats, feeSats: 0, status: 'refused', service, reason, error: decision.reason, paymentHash: decoded.paymentHash }).catch(() => {});
    return fail(decision.code, decision.reason);
  }
  if (decision.kind === 'confirm') {
    const approved = deps.confirm
      ? await deps.confirm({
          service, amountSats, feeSats, invoice, reason, why: decision.reason,
          leftTodaySats: Math.max(0, (policy?.dailySats ?? 0) - totals.todaySats),
          leftMonthSats: Math.max(0, (policy?.monthlySats ?? 0) - totals.monthSats),
        }).catch(() => false)
      : false;
    if (approved !== true) {
      await store.add({ kind: 'spend', amountSats, feeSats: 0, status: 'cancelled', service, reason, paymentHash: decoded.paymentHash }).catch(() => {});
      return fail('declined', deps.confirm ? 'You declined the payment.' : 'This payment needs your approval, and none could be asked for.');
    }
    if (decoded.expiresAt - now() < MIN_EXPIRY_LEFT_SEC * 1000) return fail('expired', 'The invoice expired while waiting for approval. Ask the service again.');
  }

  const entry = await store.add({
    kind: 'spend', amountSats, feeSats, status: 'pending', service, reason,
    paymentHash: decoded.paymentHash, invoice, expiresAt: decoded.expiresAt,
  });
  let result: Awaited<ReturnType<AgentPayWallet['payInvoice']>>;
  try {
    result = await wallet.payInvoice(invoice, feeSats);
  } catch (e) {
    await store.update(entry.id, { status: 'failed', feeSats: 0, error: message(e) });
    return fail('payment_failed', `The payment failed: ${message(e)}`);
  }
  if (result.status === 'failed') {
    await store.update(entry.id, { status: 'failed', feeSats: 0, error: 'failed' });
    return fail('payment_failed', 'The payment failed.');
  }
  if (result.status !== 'confirmed') {
    if (result.id) await store.update(entry.id, { paymentId: result.id });
    return fail('payment_pending', 'The payment was sent but has not settled yet. It is counted against your limits until it does.');
  }
  const paidFee = Number.isInteger(result.feeSats) && (result.feeSats as number) >= 0 ? (result.feeSats as number) : feeSats;
  await store.update(entry.id, { status: 'paid', feeSats: paidFee, ...(result.id ? { paymentId: result.id } : {}) });
  if (!result.preimage || !preimageMatches(result.preimage, decoded.paymentHash)) {
    return fail('bad_proof', 'The payment went through but its proof did not match the invoice.');
  }
  return { ok: true, preimage: result.preimage.toLowerCase(), amountSats, feeSats: paidFee, entryId: entry.id };
}
