/**
 * Sending from Spark to another chain (USDB or BTC out as USDC/USDT on EVM or
 * Solana): the form rules, the amounts, and the session that keeps a transfer
 * from being paid twice.
 *
 * The session is saved before any funds move. A transfer found in "paying" was
 * started but its outcome is unknown, so it is checked (by submitting the quote,
 * which moves no funds) instead of paid again; "paid" left the wallet and only
 * needs submitting; "submitted" is an order being tracked.
 */
import type {
  OrchestraAmountMode,
  OrchestraEstimate,
  OrchestraOrderStatus,
  OrchestraQuote,
  OrchestraRoute,
  SubmittedOrder,
} from '../services/orchestra/client';
import {
  CURATED_WITHDRAW_CHAINS,
  WITHDRAW_DEST_TOKENS,
  isCuratedWithdrawChain,
  isValidRecipientForFamily,
  type CrossChainDestChain,
  type CrossChainFamily,
  type CrossChainSourceKey,
} from './crosschain';

export const SOURCE_DECIMALS: Record<CrossChainSourceKey, number> = { USDB: 6, BTC: 8 };
const TERMINAL: OrchestraOrderStatus[] = ['completed', 'failed', 'refunded'];
const STATUSES: OrchestraOrderStatus[] = [
  'processing', 'confirming', 'bridging', 'swapping', 'awaiting_approval', 'refunding', 'delivering', ...TERMINAL,
];

/** Decimals the amount field takes: sats are whole, BTC has 8, USDB 6. */
export function sourceInputDecimals(source: CrossChainSourceKey, bitcoinUnit: 'BTC' | 'sats'): number {
  if (source === 'USDB') return SOURCE_DECIMALS.USDB;
  return bitcoinUnit === 'BTC' ? SOURCE_DECIMALS.BTC : 0;
}

/**
 * A typed decimal amount in smallest units, or null when it is not a positive
 * number with at most `decimals` decimals (never rounded).
 */
export function parseAmountRaw(amount: string, decimals: number): string | null {
  const text = (amount ?? '').trim().replace(',', '.');
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!text || !match || (!match[1] && !match[2])) return null;
  const frac = match[2] ?? '';
  if (frac.length > decimals) return null;
  const raw = `${match[1] || '0'}${frac.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return /^0+$/.test(raw) ? null : raw;
}

/** Destination chains for an address family, limited to what Orchestra routes from Spark. */
export function destChainsFor(routes: OrchestraRoute[], family: CrossChainFamily): CrossChainDestChain[] {
  const curated = CURATED_WITHDRAW_CHAINS.filter(c => c.family === family);
  const live = new Set(routes.filter(fromSpark).map(r => r.destinationChain.toLowerCase()));
  if (live.size === 0) return curated;
  const filtered = curated.filter(c => live.has(c.chain));
  return filtered.length ? filtered : curated;
}

/** Tokens the chosen chain can receive from Spark (USDC, USDT). */
export function destTokensFor(routes: OrchestraRoute[], chain: string): string[] {
  const all = [...WITHDRAW_DEST_TOKENS] as string[];
  const live = new Set(routes.filter(r => fromSpark(r) && r.destinationChain.toLowerCase() === chain.toLowerCase())
    .map(r => r.destinationAsset.toUpperCase()));
  if (live.size === 0) return all;
  const filtered = all.filter(t => live.has(t));
  return filtered.length ? filtered : all;
}

export function findRoute(routes: OrchestraRoute[], chain: string, token: string, source: CrossChainSourceKey): OrchestraRoute | null {
  return routes.find(r => fromSpark(r)
    && r.destinationChain.toLowerCase() === chain.toLowerCase()
    && r.destinationAsset.toUpperCase() === token.toUpperCase()
    && r.sourceAsset.toUpperCase() === source) ?? null;
}

/** Chains shown in the "send to other chains" hint: live routes from Spark, else the curated list. */
export function hintChains(routes: OrchestraRoute[]): CrossChainDestChain[] {
  const live = new Set(routes.filter(r => fromSpark(r) && isCuratedWithdrawChain(r.destinationChain)
    && (WITHDRAW_DEST_TOKENS as readonly string[]).includes(r.destinationAsset.toUpperCase()))
    .map(r => r.destinationChain.toLowerCase()));
  return live.size ? CURATED_WITHDRAW_CHAINS.filter(c => live.has(c.chain)) : CURATED_WITHDRAW_CHAINS;
}

function fromSpark(r: OrchestraRoute): boolean {
  return r?.sourceChain?.toLowerCase() === 'spark' && typeof r.destinationChain === 'string' && typeof r.destinationAsset === 'string'
    && typeof r.sourceAsset === 'string';
}

export interface CrossChainForm {
  source: CrossChainSourceKey;
  destChain: string;
  destToken: string;
  recipient: string;
  family: CrossChainFamily;
  /** exact_in: the amount is what leaves Spark; exact_out: what the recipient gets. */
  mode: OrchestraAmountMode;
  /** Smallest units of the pinned side (source for exact_in, destination token for exact_out). */
  amountRaw: string;
}

export function orchestraParams(form: CrossChainForm) {
  return {
    sourceChain: 'spark',
    sourceAsset: form.source,
    destinationChain: form.destChain,
    destinationAsset: form.destToken,
    amount: form.amountRaw,
    ...(form.mode === 'exact_out' ? { amountMode: 'exact_out' as const, targetAmountOut: form.amountRaw } : {}),
  };
}

/** Source amount this transfer spends: the typed one, or what the estimate says an exact-out needs. */
export function sourceSpendRaw(form: Pick<CrossChainForm, 'mode' | 'amountRaw'>, estimate?: Pick<OrchestraEstimate, 'requiredAmountIn'> | null): string | null {
  if (form.mode === 'exact_in') return form.amountRaw;
  const required = estimate?.requiredAmountIn;
  return required && /^\d+$/.test(required) && BigInt(required) > 0n ? BigInt(required).toString() : null;
}

export type FormProblem =
  | 'spark-disconnected' | 'not-mainnet' | 'no-balance' | 'invalid-recipient' | 'no-amount' | 'too-many-decimals'
  | 'exceeds-balance' | 'no-route';

export const FORM_PROBLEM_TEXT: Record<FormProblem, string> = {
  'spark-disconnected': 'Connect your Spark wallet to send to other chains.',
  'not-mainnet': 'Sending to other chains works on mainnet only.',
  'no-balance': 'You have no USDB or bitcoin on Spark to send.',
  'invalid-recipient': "This address doesn't match the chosen network.",
  'no-amount': 'Enter an amount.',
  'too-many-decimals': 'Too many decimal places for this amount.',
  'exceeds-balance': 'Not enough balance on Spark.',
  'no-route': "This route isn't available right now. Pick another network or token.",
};

/** The first thing stopping review of a transfer, or null when it can be reviewed. */
export function formProblem(args: {
  sparkConnected: boolean;
  mainnet: boolean;
  spendableRaw: string;
  form: CrossChainForm;
  typedAmount: string;
  inputDecimals: number;
  routeKnown: boolean;
  estimate?: Pick<OrchestraEstimate, 'requiredAmountIn'> | null;
}): FormProblem | null {
  const { form } = args;
  if (!args.sparkConnected) return 'spark-disconnected';
  if (!args.mainnet) return 'not-mainnet';
  if (!/^\d+$/.test(args.spendableRaw) || BigInt(args.spendableRaw) <= 0n) return 'no-balance';
  if (!isValidRecipientForFamily(form.recipient, form.family)) return 'invalid-recipient';
  if (!args.typedAmount.trim()) return 'no-amount';
  if (!parseAmountRaw(args.typedAmount, args.inputDecimals)) {
    return /[.,]\d+$/.test(args.typedAmount.trim()) && parseAmountRaw(args.typedAmount, 18) ? 'too-many-decimals' : 'no-amount';
  }
  if (!args.routeKnown) return 'no-route';
  const spend = sourceSpendRaw(form, args.estimate);
  if (spend && BigInt(spend) > BigInt(args.spendableRaw)) return 'exceeds-balance';
  return null;
}

/**
 * Source amount to pay the quote's deposit address. An exact-out quote must say
 * what it needs: the typed amount is in the destination token there, so it is
 * never used as the source amount.
 */
export function depositAmountRaw(quote: Pick<OrchestraQuote, 'amountIn' | 'requiredAmountIn'>, form: Pick<CrossChainForm, 'mode' | 'amountRaw'>): string {
  const pick = (v?: string) => (v && /^\d+$/.test(v) && BigInt(v) > 0n ? BigInt(v).toString() : null);
  if (form.mode === 'exact_out') {
    const required = pick(quote.requiredAmountIn) ?? pick(quote.amountIn);
    if (!required) throw new Error("The quote didn't say how much to send. Nothing was sent; try again.");
    return required;
  }
  return pick(quote.amountIn) ?? form.amountRaw;
}

/** Spark's send calls take numbers: refuse anything that would not survive the conversion. */
export function toSparkAmount(raw: string): number {
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new Error('The quote has an invalid amount. Nothing was sent; try again.');
  if (BigInt(raw) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This amount is too large to send from Spark.');
  return Number(raw);
}

/** Default allowed slip between the reviewed estimate and the quote that gets paid. */
export const QUOTE_TOLERANCE_BPS = 100;

/**
 * True when the quote is worse for the user than what they reviewed by more than
 * the tolerance: less delivered for exact-in, more spent for exact-out.
 */
export function quoteWorseThanReviewed(
  reviewed: Pick<OrchestraEstimate, 'estimatedOut' | 'requiredAmountIn'>,
  quote: Pick<OrchestraQuote, 'estimatedOut' | 'requiredAmountIn' | 'amountIn'>,
  mode: OrchestraAmountMode,
  toleranceBps = QUOTE_TOLERANCE_BPS,
): boolean {
  const int = (v?: string) => (v && /^\d+$/.test(v) ? BigInt(v) : null);
  const scale = 10_000n;
  if (mode === 'exact_out') {
    const before = int(reviewed.requiredAmountIn);
    const after = int(quote.requiredAmountIn) ?? int(quote.amountIn);
    if (before === null || after === null) return after === null;
    return after * scale > before * (scale + BigInt(toleranceBps));
  }
  const before = int(reviewed.estimatedOut);
  const after = int(quote.estimatedOut);
  if (before === null || after === null) return after === null;
  return after * scale < before * (scale - BigInt(toleranceBps));
}

/** The Spark transfer id from a send result, whatever the adapter calls it. */
export function pickSparkTxHash(result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const v = r.txId ?? r.txHash ?? r.txid ?? r.transferId ?? r.paymentHash ?? r.id;
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type CrossChainPhase = 'paying' | 'paid' | 'submitted' | 'done';

export interface CrossChainOrderRef {
  id: string;
  status: OrchestraOrderStatus;
  readToken?: string;
  amountOut?: string;
}

export interface CrossChainSendSession {
  version: 1;
  id: string;
  phase: CrossChainPhase;
  recipient: string;
  family: CrossChainFamily;
  destChain: string;
  destToken: string;
  destDecimals: number;
  source: CrossChainSourceKey;
  mode: OrchestraAmountMode;
  quoteId: string;
  depositAddress: string;
  sourceSparkAddress: string;
  /** What left (or was about to leave) Spark, in the source's smallest units. */
  sourceAmountRaw: string;
  /** Quoted delivery, in the destination token's smallest units. */
  expectedOutRaw?: string;
  sparkTxHash?: string;
  order?: CrossChainOrderRef;
  /** Why the last step failed, for the user. */
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  /** Set when the user chose to move on from a transfer whose outcome is unknown. */
  dismissedAt?: number;
}

/** The record written just before paying, so a crash mid-send is never read as "not paid". */
export function beginPaying(args: {
  id: string;
  form: CrossChainForm;
  quote: Pick<OrchestraQuote, 'quoteId' | 'depositAddress' | 'estimatedOut'>;
  sourceSparkAddress: string;
  sourceAmountRaw: string;
  destDecimals: number;
  now: number;
}): CrossChainSendSession {
  const { form, quote } = args;
  if (!quote.quoteId || !quote.depositAddress) throw new Error('The quote is missing its deposit address. Nothing was sent; try again.');
  if (!args.sourceSparkAddress) throw new Error('Could not read your Spark address. Nothing was sent; try again.');
  return {
    version: 1, id: args.id, phase: 'paying',
    recipient: form.recipient, family: form.family, destChain: form.destChain, destToken: form.destToken, destDecimals: args.destDecimals,
    source: form.source, mode: form.mode,
    quoteId: quote.quoteId, depositAddress: quote.depositAddress, sourceSparkAddress: args.sourceSparkAddress,
    sourceAmountRaw: args.sourceAmountRaw,
    ...(quote.estimatedOut ? { expectedOutRaw: quote.estimatedOut } : {}),
    createdAt: args.now, updatedAt: args.now,
  };
}

export function markPaid(s: CrossChainSendSession, sparkTxHash: string, now: number): CrossChainSendSession {
  if (s.phase !== 'paying') throw new Error(`Cannot mark a ${s.phase} transfer as paid.`);
  const { lastError: _drop, ...rest } = s;
  return { ...rest, phase: 'paid', ...(sparkTxHash ? { sparkTxHash } : {}), updatedAt: now };
}

export function markSubmitted(s: CrossChainSendSession, submitted: SubmittedOrder, now: number): CrossChainSendSession {
  if (s.phase !== 'paying' && s.phase !== 'paid') throw new Error(`Cannot submit a ${s.phase} transfer.`);
  if (!submitted?.orderId) throw new Error('The order was not created.');
  const status = normalizeStatus(submitted.status) ?? 'processing';
  const { lastError: _drop, ...rest } = s;
  return {
    ...rest,
    phase: TERMINAL.includes(status) ? 'done' : 'submitted',
    order: { id: submitted.orderId, status, ...(submitted.readToken ? { readToken: submitted.readToken } : {}) },
    updatedAt: now,
  };
}

/** Merge a status poll; a terminal status ends the session. */
export function applyOrderStatus(s: CrossChainSendSession, update: { status?: string; amountOut?: string }, now: number): CrossChainSendSession {
  if (!s.order) return s;
  const status = normalizeStatus(update.status) ?? s.order.status;
  const order: CrossChainOrderRef = { ...s.order, status, ...(update.amountOut ? { amountOut: update.amountOut } : {}) };
  return { ...s, order, phase: TERMINAL.includes(status) ? 'done' : s.phase, updatedAt: now };
}

export function withError(s: CrossChainSendSession, message: string, now: number): CrossChainSendSession {
  return { ...s, lastError: message, updatedAt: now };
}

export function dismissSession(s: CrossChainSendSession, now: number): CrossChainSendSession {
  return { ...s, dismissedAt: now, updatedAt: now };
}

function normalizeStatus(status: unknown): OrchestraOrderStatus | null {
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  return (STATUSES as string[]).includes(s) ? (s as OrchestraOrderStatus) : null;
}

/** Still has work to do and blocks starting another transfer. */
export function isUnresolved(s: CrossChainSendSession | null | undefined): s is CrossChainSendSession {
  return !!s && !s.dismissedAt && s.phase !== 'done';
}

export type ResumeAction = 'verify' | 'submit' | 'track' | 'none';

/**
 * What reopening a session does. None of these moves funds: "verify" submits the
 * quote without a transfer id (it only succeeds once the deposit arrived), "submit"
 * re-submits the known transfer, "track" polls the order.
 */
export function resumeAction(s: CrossChainSendSession | null | undefined): ResumeAction {
  if (!isUnresolved(s)) return 'none';
  if (s.phase === 'paying') return 'verify';
  if (s.phase === 'paid') return 'submit';
  return s.order ? 'track' : 'submit';
}

/** May the user start a new transfer? Never while an earlier one may have been paid. */
export function canStartTransfer(existing: CrossChainSendSession | null | undefined): boolean {
  return !isUnresolved(existing);
}

/** Reads a stored session; throws when the record exists but can't be trusted. */
export function parseSession(raw: string | null): CrossChainSendSession | null {
  if (!raw) return null;
  let v: any;
  try { v = JSON.parse(raw); } catch { throw new Error('Cross-chain transfer record is unreadable.'); }
  const str = (x: unknown) => typeof x === 'string' && x.length > 0;
  const ok = v && v.version === 1 && str(v.id) && ['paying', 'paid', 'submitted', 'done'].includes(v.phase)
    && str(v.recipient) && (v.family === 'evm' || v.family === 'solana') && str(v.destChain) && str(v.destToken)
    && (v.source === 'USDB' || v.source === 'BTC') && (v.mode === 'exact_in' || v.mode === 'exact_out')
    && str(v.quoteId) && str(v.depositAddress) && str(v.sourceSparkAddress) && /^\d+$/.test(String(v.sourceAmountRaw))
    && Number.isInteger(v.destDecimals) && Number.isSafeInteger(v.createdAt) && Number.isSafeInteger(v.updatedAt)
    && (v.order === undefined || (str(v.order.id) && normalizeStatus(v.order.status) !== null))
    && (v.phase !== 'submitted' || v.order !== undefined);
  if (!ok) throw new Error('Cross-chain transfer record is unreadable.');
  return v as CrossChainSendSession;
}

/** "0x5aAe…eAed" */
export function shortAddress(address: string, keep = 6): string {
  return address.length <= keep * 2 + 1 ? address : `${address.slice(0, keep)}…${address.slice(-keep + 2)}`;
}

/**
 * The address in a scanned wallet URI (ethereum:, solana:). An EIP-681 contract
 * call (ethereum:<token>/transfer?address=…) names the token contract first, so it
 * is not unwrapped: paying that address would send to the contract.
 */
export function unwrapCrossChainUri(text: string): string {
  const t = (text ?? '').trim();
  const m = /^(?:ethereum|solana):(?:pay-)?([^?@/]+)(?:@\d+)?(\/)?/i.exec(t);
  if (!m) return t;
  return m[2] ? '' : m[1];
}
