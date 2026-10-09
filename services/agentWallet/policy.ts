// The Agent wallet's spending rules, and the one decision every agent payment
// goes through. Pure: the caller supplies the policy, what was already spent
// and the request. Anything malformed is refused, never paid.

export interface SpendingPolicy {
  /** Largest single payment, fees included. */
  perPaymentSats: number;
  /** Total per calendar day (device time), fees included. */
  dailySats: number;
  /** Total per calendar month (device time), fees included. */
  monthlySats: number;
  /** Payments below this to an allowed service go through without asking. 0 = always ask. */
  autoApproveSats: number;
  /** Services (host names) that may be paid without asking, under the threshold. */
  allowedServices: string[];
  paused: boolean;
}

export const DEFAULT_POLICY: SpendingPolicy = Object.freeze({
  perPaymentSats: 1_000,
  dailySats: 5_000,
  monthlySats: 50_000,
  autoApproveSats: 100,
  allowedServices: [] as string[],
  paused: false,
}) as SpendingPolicy;

/** Hard ceiling for any single limit, so a corrupt value can't open the wallet. */
export const MAX_LIMIT_SATS = 10_000_000;

export interface SpendTotals {
  todaySats: number;
  monthSats: number;
}

export interface SpendRequest {
  amountSats: number;
  /** Most the payment may cost in fees. */
  feeSats: number;
  service: string;
}

export type DenyCode =
  | 'invalid_policy'
  | 'invalid_request'
  | 'paused'
  | 'per_payment_limit'
  | 'daily_limit'
  | 'monthly_limit'
  | 'insufficient_balance';

export type SpendDecision =
  | { kind: 'auto' }
  | { kind: 'confirm'; reason: string }
  | { kind: 'deny'; code: DenyCode; reason: string };

const isSats = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_LIMIT_SATS;

/** A service as the policy stores it: the lower-case host of a URL or host name. */
export function normalizeService(input: unknown): string | null {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
    const m = raw.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/:?#]+)/);
    if (!m) return null;
    host = m[1];
  }
  host = host.replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host) || host.length > 253) return null;
  return host;
}

/** A valid copy of a stored policy, or null when anything about it is off. */
export function normalizePolicy(raw: unknown): SpendingPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!isSats(p.perPaymentSats) || !isSats(p.dailySats) || !isSats(p.monthlySats) || !isSats(p.autoApproveSats)) return null;
  if (typeof p.paused !== 'boolean' || !Array.isArray(p.allowedServices)) return null;
  const services: string[] = [];
  for (const s of p.allowedServices) {
    const host = normalizeService(s);
    if (!host) return null;
    if (!services.includes(host)) services.push(host);
  }
  return {
    perPaymentSats: p.perPaymentSats,
    dailySats: p.dailySats,
    monthlySats: p.monthlySats,
    autoApproveSats: p.autoApproveSats,
    allowedServices: services,
    paused: p.paused,
  };
}

/** Whether a policy as edited by the user makes sense (shown before saving). */
export function policyProblem(p: SpendingPolicy): string | null {
  if (p.perPaymentSats > p.dailySats) return 'The per-payment limit is above the daily limit.';
  if (p.dailySats > p.monthlySats) return 'The daily limit is above the monthly limit.';
  if (p.autoApproveSats > p.perPaymentSats) return 'Pay-without-asking is above the per-payment limit.';
  return null;
}

const sats = (n: number) => `${Math.round(n).toLocaleString('en-US')} sats`;

/**
 * Decide one agent payment. Only `policy`, `totals` and the three request
 * fields are read; nothing a service or tool returns can change a limit, add
 * an allowed service or skip the question.
 */
export function evaluateSpend(policy: unknown, totals: unknown, request: unknown, balanceSats?: unknown): SpendDecision {
  try {
    const p = normalizePolicy(policy);
    if (!p) return { kind: 'deny', code: 'invalid_policy', reason: "The Agent wallet's spending rules could not be read." };
    const t = totals as SpendTotals | null;
    const r = request as SpendRequest | null;
    if (!t || !r || typeof t !== 'object' || typeof r !== 'object') {
      return { kind: 'deny', code: 'invalid_request', reason: 'The payment request was incomplete.' };
    }
    const amount = r.amountSats;
    const fee = r.feeSats;
    const service = normalizeService(r.service);
    if (!isSats(amount) || amount <= 0 || !isSats(fee) || !service) {
      return { kind: 'deny', code: 'invalid_request', reason: 'The payment request was incomplete.' };
    }
    const today = Number(t.todaySats);
    const month = Number(t.monthSats);
    if (!Number.isFinite(today) || !Number.isFinite(month) || today < 0 || month < 0) {
      return { kind: 'deny', code: 'invalid_request', reason: 'Past payments could not be added up.' };
    }
    if (p.paused) return { kind: 'deny', code: 'paused', reason: 'Agent payments are paused.' };
    const cost = amount + fee;
    if (cost > p.perPaymentSats) {
      return { kind: 'deny', code: 'per_payment_limit', reason: `${sats(cost)} is above the ${sats(p.perPaymentSats)} per-payment limit.` };
    }
    if (today + cost > p.dailySats) {
      return { kind: 'deny', code: 'daily_limit', reason: `This would pass today's limit: ${sats(Math.max(0, p.dailySats - today))} left of ${sats(p.dailySats)}.` };
    }
    if (month + cost > p.monthlySats) {
      return { kind: 'deny', code: 'monthly_limit', reason: `This would pass this month's limit: ${sats(Math.max(0, p.monthlySats - month))} left of ${sats(p.monthlySats)}.` };
    }
    if (balanceSats !== undefined) {
      const balance = Number(balanceSats);
      if (!Number.isFinite(balance) || balance < cost) {
        return { kind: 'deny', code: 'insufficient_balance', reason: `The Agent wallet has ${sats(Number.isFinite(balance) ? balance : 0)}, not enough for ${sats(cost)}.` };
      }
    }
    if (!p.allowedServices.includes(service)) return { kind: 'confirm', reason: `${service} is not on your allowed list.` };
    if (cost >= p.autoApproveSats) return { kind: 'confirm', reason: `${sats(cost)} is above what the assistant pays without asking.` };
    return { kind: 'auto' };
  } catch {
    return { kind: 'deny', code: 'invalid_request', reason: 'The payment could not be checked.' };
  }
}
