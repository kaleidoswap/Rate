import { loadPaymentAttempts, updatePaymentAttempt, unresolvedAttempt } from './attempts';
import { checkPaymentStatus, paymentAccountNetwork, prepareKaleidoPay } from './index';
import { checkOnchainConfirmation } from './onchainConfirmation';
import { awaitingOnchainConfirmation } from '../../utils/payment-presentation';

/** Reconcile saved receipts only. Never creates a quote or retries a send. */
export async function reconcileOtherPayments(walletId: number, isCurrent: () => boolean): Promise<boolean> {
  const attempts = (await loadPaymentAttempts(walletId)).filter(a => !a.sourceId.startsWith('arkade') && (unresolvedAttempt(a) || awaitingOnchainConfirmation(a)))
    .sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0)).slice(0, 5);
  if (!attempts.length || !isCurrent()) return false;
  await prepareKaleidoPay();
  let changed = false;
  for (const attempt of attempts) {
    if (!isCurrent()) break;
    if (!attempt.network || paymentAccountNetwork(attempt.sourceId) !== attempt.network) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        (async () => checkOnchainConfirmation({ ...attempt, ...(attempt.status === 'completed' ? {} : await checkPaymentStatus(attempt.sourceId, attempt.id)) }))(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 15000); }),
      ]);
      if (!isCurrent()) break;
      const saved = await updatePaymentAttempt(walletId, { ...result, lastCheckedAt: Date.now(), checkFailed: false });
      changed = (saved && (result.status !== attempt.status || result.onchainConfirmed !== attempt.onchainConfirmed)) || changed;
    } catch {
      if (isCurrent()) await updatePaymentAttempt(walletId, { ...attempt, lastCheckedAt: Date.now(), checkFailed: true });
    } finally { if (timer) clearTimeout(timer); }
  }
  return changed;
}
