// services/kaleidoPay/activity.ts
//
// Electrum swap attempts as activity-feed input. Each paid swap ends in an
// on-chain payment to the requested address: the provider's lockup, then the
// app's claim. Confirmation comes from mempool.space and is cached once final.

import type { SwapAttempt } from '@universal-bolt12/swap-market';
import { MempoolClient } from '../mempool/MempoolClient';
import type { ActivityItem, ActivityLayer, SwapAttemptActivityInput } from '../ActivityService';
import { dismissPaymentAttempt, loadPaymentAttempt, loadPaymentAttempts, unresolvedAttempt } from './attempts';
import { removeContactEvent } from '../contactHistory';
import { kaleidoPayAttempts } from './recovery';

/** Status lookups per feed load; older swaps are shown without one. */
const MAX_STATUS_CHECKS = 10;
const confirmedTxids = new Set<string>();

export function swapAttemptTxid(a: SwapAttempt): string | undefined {
  return a.claim?.txid ?? a.lockup?.txid;
}

export async function loadSwapAttemptActivity(
  deps: { list?: () => Promise<SwapAttempt[]>; client?: (n: SwapAttempt['swap']['network']) => MempoolClient } = {},
): Promise<SwapAttemptActivityInput[]> {
  const list = deps.list ?? (() => kaleidoPayAttempts.list());
  const client = deps.client ?? (n => new MempoolClient(n));
  const attempts = (await list().catch(() => [] as SwapAttempt[]))
    // Never-paid swaps moved no funds.
    .filter(a => a.stage !== 'created' && !(a.stage === 'failed' && a.error === 'never paid'))
    .sort((x, y) => y.updatedAt - x.updatedAt);

  let checks = 0;
  return Promise.all(attempts.map(async a => {
    const txid = swapAttemptTxid(a);
    let txConfirmed = !!txid && confirmedTxids.has(txid);
    if (txid && !txConfirmed && a.stage !== 'failed' && checks++ < MAX_STATUS_CHECKS) {
      txConfirmed = await client(a.swap.network).getTxStatus(txid).then(s => s.confirmed, () => false);
      if (txConfirmed) confirmedTxids.add(txid);
    }
    return {
      id: a.id,
      failed: a.stage === 'failed',
      network: a.swap.network,
      amountSat: a.swap.onchainAmount - (a.claim?.fee ?? 0),
      fee: a.claim?.fee,
      txid,
      // The payment lands with the claim; a confirmed lockup alone is still pending.
      confirmed: !!a.claim && txConfirmed,
      updatedAt: a.updatedAt,
    };
  }));
}

/** Shown on the payment-attempt row; opening it resumes the check in Send. */
export const PAYMENT_ATTEMPT_KIND = 'payment-attempt';

/**
 * The last payment while its outcome is still being checked, as a pending
 * activity item: it belongs in the history with everything else, not above it.
 */
export async function loadPendingPaymentActivity(walletId: number | undefined): Promise<ActivityItem[]> {
  if (walletId == null) return [];
  const attempts = await loadPaymentAttempts(walletId).catch(() => []);
  return attempts.filter(unresolvedAttempt).map(attempt => {
  const source = attempt.sourceId.toLowerCase();
  const layer: ActivityLayer = source.startsWith('spark') ? 'Spark' : source.startsWith('bark') ? 'Bark'
    : source.startsWith('ark') ? 'Arkade' : source.startsWith('rgb') ? 'RGB-LN' : 'LN';
  return {
    id: `payment-attempt-${attempt.id}`,
    contactName: attempt.recipientName,
    type: 'send',
    source: 'payment',
    asset: 'BTC',
    assetName: attempt.recipient,
    assetTicker: '',
    assetPrecision: 0,
    amount: attempt.total,
    status: attempt.status === 'unknown' ? 'unknown' : 'pending',
    timestamp: attempt.createdAt,
    txid: attempt.reference ?? '',
    layer,
    kind: PAYMENT_ATTEMPT_KIND,
  };
  });
}

/** The saved payment behind an activity row, when the row is one (see loadPendingPaymentActivity). */
export function paymentAttemptIdOf(item: Pick<ActivityItem, 'id' | 'kind'>): string | undefined {
  const prefix = 'payment-attempt-';
  return item.kind === PAYMENT_ATTEMPT_KIND && item.id.startsWith(prefix) ? item.id.slice(prefix.length) : undefined;
}

/**
 * Removes a payment still pending or needing a check from this phone's Activity and the
 * contact's history. Only the local record changes: nothing is cancelled, no funds move.
 * The record is kept, marked dismissed (see dismissPaymentAttempt). False when there was
 * nothing to remove (already settled or removed).
 */
export async function dismissPendingPayment(walletId: number, attemptId: string): Promise<boolean> {
  const attempt = await loadPaymentAttempt(walletId, attemptId);
  if (!attempt || !unresolvedAttempt(attempt)) return false;
  await dismissPaymentAttempt(walletId, attempt);
  await removeContactEvent(walletId, attemptId).catch(() => {});
  return true;
}
