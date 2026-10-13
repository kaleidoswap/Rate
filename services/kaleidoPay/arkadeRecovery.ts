import { recoverArkadePending } from '../protocols/arkadePending';
import { checkPaymentStatus } from './index';
import { loadPaymentAttempts, updatePaymentAttempt } from './attempts';
import { checkOnchainConfirmation } from './onchainConfirmation';
import { protocolManager } from '../protocols';
const flights = new Map<number, Promise<boolean>>();
/** Read/reconcile only; never calls send or execute. Resumes after app/account reconnect. */
export function reconcileArkadePayment(walletId: number, isCurrent: () => boolean = () => true): Promise<boolean> {
  if (flights.has(walletId)) return flights.get(walletId)!;
  const task = (async () => {
    const attempts = await loadPaymentAttempts(walletId);
    let changed = false;
    for (const attempt of attempts) {
      changed = (await (async () => {
    if (!attempt || attempt.dismissedAt || !['arkade', 'arkade-onchain'].includes(attempt.sourceId)
      || attempt.status === 'failed' || (attempt.status === 'completed' && (attempt.sourceId !== 'arkade-onchain' || attempt.onchainConfirmed))) return false;
    const adapter: any = protocolManager.getAdapterIfAvailable('ARKADE');
    if (!adapter?.isConnected() || !isCurrent()) return false;
    const wallet = adapter.rawWallet;
    const network = adapter.arkInfo?.network === 'bitcoin' ? 'mainnet' : adapter.arkInfo?.network;
    // Unknown/mismatched networks must not inspect a payment through another account.
    if (!attempt.network || !(network === attempt.network || (network === 'mutinynet' && attempt.network === 'signet'))) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => isCurrent() && adapter.isConnected() && adapter.rawWallet === wallet;
    try {
      // Pending finalization is the same idempotent recovery as the official worker.
      // Its txids are not guessed to belong to this attempt when its receipt is missing.
      const read = async () => {
        if (attempt.sourceId === 'arkade' && attempt.status !== 'completed' && wallet?.finalizePendingTxs) await recoverArkadePending(wallet);
        return attempt.status === 'completed' ? attempt : checkPaymentStatus(attempt.sourceId, attempt.id);
      };
      const result = await Promise.race([
        read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 15000); }),
      ]);
      const updated = await checkOnchainConfirmation({ ...attempt, ...result, lastCheckedAt: Date.now(), checkFailed: false });
      if (!current()) return false;
      const saved = await updatePaymentAttempt(walletId, updated);
      return saved && (updated.status !== attempt.status || updated.onchainConfirmed !== attempt.onchainConfirmed);
    } catch {
      if (current()) await updatePaymentAttempt(walletId, { ...attempt, lastCheckedAt: Date.now(), checkFailed: true });
      return false;
    } finally { if (timer) clearTimeout(timer); }
      })()) || changed;
      if (!isCurrent()) break;
    }
    return changed;
  })().finally(() => { flights.delete(walletId); });
  flights.set(walletId, task); return task;
}
