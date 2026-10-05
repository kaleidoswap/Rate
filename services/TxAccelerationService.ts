// services/TxAccelerationService.ts
//
// "Accelerate" for a pending on-chain transaction. Works out which methods
// apply to a txid and runs the one the user picks:
//
//   • Mempool Accelerator (mainnet) — mempool.space gets the tx mined
//     out-of-band for a fee, paid by Lightning from the wallet. Works for any
//     unconfirmed tx, incoming or outgoing, without touching its inputs.
//   • Fee bump of an Electrum swap claim (RBF) — the app built and signed the
//     claim, so it can re-sign it at a higher fee rate. The claim spends the
//     provider's lockup, so a richer claim also pulls an unconfirmed lockup
//     along (CPFP). The extra fee comes out of the claimed output.
//   • Open in mempool.space — explorer page (accelerator panel on mainnet).
//
// CPFP/RBF for other wallets is not offered: no connected adapter can build a
// replacement or child transaction yet.

import { buildClaimTx, claimFee } from '@universal-bolt12/swap-market';
import type { AttemptStore, SecretStore, SwapAttempt } from '@universal-bolt12/swap-market';
import { decodeBolt11 } from '../utils/decodeInvoice';
import type { ActivityItem } from './ActivityService';
import {
  MempoolClient,
  MempoolError,
  accelerationPrice,
  acceleratedFeeRate,
  isMempoolNetwork,
  mempoolTxUrl,
} from './mempool/MempoolClient';
import type { AccelerationEstimate, MempoolNetwork } from './mempool/MempoolClient';

export interface AccelerationTarget {
  txid: string;
  network: MempoolNetwork;
  /** KaleidoPay/Electrum swap this tx belongs to (lockup or claim). */
  swapAttemptId?: string;
}

export type AccelerationOption =
  | {
      kind: 'mempool';
      id: string;
      bid: number;
      /** Total charged by mempool, in sats. */
      price: number;
      /** Package fee rate the bid buys, sat/vB. */
      feeRate: number;
      recommended: boolean;
    }
  | {
      kind: 'rbf-claim';
      id: string;
      attemptId: string;
      label: string;
      feeRate: number;
      fee: number;
      /** Extra fee over the current claim; the recipient receives this much less. */
      extraFee: number;
    }
  | { kind: 'explorer'; id: 'explorer'; url: string };

export interface AccelerationPlan {
  status: 'confirmed' | 'unconfirmed' | 'unknown';
  /** Mempool is already accelerating this tx. */
  accelerating: boolean;
  options: AccelerationOption[];
  /** Why a method isn't offered, for display. */
  notes: string[];
}

/** What to accelerate, for a pending on-chain item on a network mempool.space covers. */
export function accelerationTarget(item: ActivityItem): AccelerationTarget | null {
  if (item.layer !== 'L1' || item.status !== 'pending' || !/^[0-9a-f]{64}$/i.test(item.txid)) return null;
  if (!isMempoolNetwork(item.network)) return null;
  return { txid: item.txid, network: item.network, swapAttemptId: item.swapAttemptId };
}

export interface AccelerationDeps {
  client(network: MempoolNetwork): MempoolClient;
  attempts: AttemptStore;
  secrets: SecretStore;
  /** Pays a BOLT11 invoice from the wallet. */
  payInvoice(bolt11: string): Promise<void>;
  sleep?(ms: number): Promise<void>;
}

/** Virtual size of an Electrum swap claim (one P2WSH input, one output). */
export const CLAIM_VBYTES = claimFee(1);
const DUST = 546;
/** BIP125 needs the replacement to pay at least the old fee plus its own relay fee. */
const MIN_RBF_STEP = 1;

// Same key swap-market uses for the preimage and claim key (attempt.ts secretKey).
const swapSecretKey = (id: string) => `kaleidopay.swap.${id}`;

export async function planAcceleration(target: AccelerationTarget, deps: AccelerationDeps): Promise<AccelerationPlan> {
  const client = deps.client(target.network);
  const notes: string[] = [];
  const options: AccelerationOption[] = [];
  const explorer: AccelerationOption = { kind: 'explorer', id: 'explorer', url: mempoolTxUrl(target.txid, target.network, true) };

  const status = await client.getTxStatus(target.txid).then(
    s => (s.confirmed ? 'confirmed' as const : 'unconfirmed' as const),
    () => 'unknown' as const,
  );
  if (status === 'confirmed') return { status, accelerating: false, options: [explorer], notes: ['Already confirmed.'] };
  if (status === 'unknown') notes.push('mempool.space has not seen this transaction yet.');

  const accelerating = await client.isAccelerating(target.txid).catch(() => false);

  if (!client.supportsAccelerator) {
    notes.push('Mempool Accelerator only works on mainnet.');
  } else if (accelerating) {
    notes.push('Mempool is already accelerating this transaction.');
  } else if (status === 'unconfirmed') {
    try {
      options.push(...mempoolOptions(await client.estimateAcceleration(target.txid)));
      if (!options.length) notes.push('Mempool Accelerator has no offer for this transaction.');
    } catch (e) {
      notes.push(acceleratorError(e));
    }
  }

  if (target.swapAttemptId) {
    const attempt = await deps.attempts.load(target.swapAttemptId).catch(() => null);
    const bump = attempt ? await claimBumpOptions(attempt, client).catch(() => null) : null;
    if (bump?.length) options.push(...bump);
    else if (attempt) notes.push(claimBumpUnavailable(attempt));
  }

  options.push(explorer);
  return { status, accelerating, options, notes };
}

export function mempoolOptions(e: AccelerationEstimate): AccelerationOption[] {
  if (e.unavailable) return [];
  const affordable = e.bids.filter(bid => {
    const price = accelerationPrice(e, bid);
    return !e.bitcoinPayment || (price >= e.bitcoinPayment.min && price <= e.bitcoinPayment.max);
  });
  // mempool.space's checkout defaults to the second tier.
  const recommended = affordable[Math.min(1, affordable.length - 1)];
  return affordable.map(bid => ({
    kind: 'mempool' as const,
    id: `mempool-${bid}`,
    bid,
    price: accelerationPrice(e, bid),
    feeRate: round1(acceleratedFeeRate(e, bid)),
    recommended: bid === recommended,
  }));
}

/** Higher-fee replacements for an Electrum swap claim that is broadcast but unconfirmed. */
export async function claimBumpOptions(a: SwapAttempt, client: MempoolClient): Promise<AccelerationOption[]> {
  if (!a.claim || !a.lockup || !['claimed', 'claiming'].includes(a.stage)) return [];
  const currentRate = a.claim.fee / CLAIM_VBYTES;
  const floor = Math.ceil((currentRate + MIN_RBF_STEP) * 10) / 10;
  const rates = await client.getFeeRates();
  const tiers: { label: string; rate: number }[] = [
    { label: 'Within an hour', rate: rates.halfHourFee },
    { label: 'Next block', rate: rates.fastestFee },
  ];
  const seen = new Set<number>();
  const out: AccelerationOption[] = [];
  for (const t of tiers) {
    const rate = Math.max(floor, round1Up(t.rate));
    if (seen.has(rate)) continue;
    seen.add(rate);
    const fee = claimFee(rate);
    if (a.swap.onchainAmount - fee < DUST) continue;
    out.push({ kind: 'rbf-claim', id: `rbf-${rate}`, attemptId: a.id, label: t.label, feeRate: rate, fee, extraFee: fee - a.claim.fee });
  }
  return out;
}

/** Re-signs and broadcasts the swap claim at `feeRate`. Returns the replacement txid. */
export async function bumpClaimFee(attemptId: string, feeRate: number, deps: AccelerationDeps): Promise<string> {
  const a = await deps.attempts.load(attemptId);
  if (!a?.claim || !a.lockup) throw new Error('This swap has no claim to bump.');
  if (claimFee(feeRate) < a.claim.fee + CLAIM_VBYTES * MIN_RBF_STEP) throw new Error('The new fee rate must be at least 1 sat/vB higher.');
  const raw = await deps.secrets.get(swapSecretKey(a.id));
  if (!raw) throw new Error('Swap secrets are missing from secure storage.');
  const { preimage, claimPrivkey } = JSON.parse(raw);
  const built = buildClaimTx({
    txid: a.lockup.txid,
    vout: a.lockup.vout,
    amount: a.swap.onchainAmount,
    redeemScript: a.swap.redeemScript,
    preimage,
    claimPrivkey,
    destination: a.swap.destination,
    feeRate,
    network: a.swap.network,
  });
  const txid = await deps.client(a.swap.network).broadcast(built.hex);
  if (txid !== built.txid) throw new Error('Broadcast returned another transaction id.');
  // Saved only after the replacement is accepted, so a rejected bump leaves the
  // working claim in place for recovery.
  await deps.attempts.save({ ...a, stage: 'claimed', claim: built, error: undefined, updatedAt: Date.now() });
  return txid;
}

export type MempoolAccelerationResult = 'accelerating' | 'payment-pending';

/**
 * Buys a Mempool Accelerator boost. Refuses to pay an invoice above
 * `approvedPrice` (what the user confirmed) or for another network.
 */
export async function accelerateWithMempool(
  p: { txid: string; bid: number; approvedPrice: number; onInvoice?(amountSats: number): void },
  deps: AccelerationDeps,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<MempoolAccelerationResult> {
  const client = deps.client('mainnet');
  const invoice = await client.requestAccelerationInvoice(p.txid, p.bid);
  const decoded = decodeBolt11(invoice.bolt11);
  // Mainnet BOLT11 is `lnbc…`; regtest's `lnbcrt…` shares the prefix.
  if (!/^lnbc(?!rt)/i.test(invoice.bolt11)) {
    throw new Error('Mempool returned an invoice for another network.');
  }
  if (decoded.amountSats == null) throw new Error('Mempool returned an invoice without an amount.');
  if (decoded.amountSats > p.approvedPrice) {
    throw new Error(`Mempool asked for ${decoded.amountSats} sats, more than the ${p.approvedPrice} sats you approved.`);
  }
  p.onInvoice?.(decoded.amountSats);
  await deps.payInvoice(invoice.bolt11);

  const sleep = deps.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    const check = await client.checkAccelerationPayment(invoice.id).catch(() => 'pending' as const);
    if (check === 'settled') return 'accelerating';
    if (check === 'failed') throw new Error('Mempool could not confirm the payment.');
    await sleep(opts.pollMs ?? 3000);
  }
  return 'payment-pending';
}

function acceleratorError(e: unknown): string {
  if (e instanceof MempoolError && e.code === 'cannot_accelerate_tx') return 'Mempool Accelerator cannot accelerate this transaction.';
  if (e instanceof MempoolError && e.code) return `Mempool Accelerator: ${e.code.replace(/_/g, ' ')}.`;
  return 'Mempool Accelerator is unreachable right now.';
}

function claimBumpUnavailable(a: SwapAttempt): string {
  if (!a.claim) return 'The swap claim is not broadcast yet; it is sent once the provider’s lockup confirms.';
  if (!['claimed', 'claiming'].includes(a.stage)) return 'This swap cannot be fee-bumped.';
  return 'The claim cannot pay a higher fee: the remaining amount would be dust.';
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round1Up = (n: number) => Math.ceil(n * 10) / 10;
