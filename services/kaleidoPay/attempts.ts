import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PaymentResult } from './index';
export interface PaymentAttempt extends PaymentResult {
  id: string; sourceId: string; provider: string; total: string; recipient: string; createdAt: number;
  /** Display metadata captured before sending; optional for older records. Never store an invoice or secret. */
  destinationRail?: string; network?: string; onchainConfirmed?: boolean;
  recipientName?: string; feeDisplay?: string; accountName?: string;
  /** Set when the user chose to move on from a payment whose outcome could not be determined. */
  dismissedAt?: number;
  lastCheckedAt?: number; checkFailed?: boolean;
}
const key = (walletId: number) => `kaleidopay-attempt-v1-${walletId}`;
export async function loadPaymentAttempt(walletId: number, attemptId?: string): Promise<PaymentAttempt | null> {
  if (attemptId) return (await loadPaymentAttempts(walletId)).find(a => a.id === attemptId) ?? null;
  const raw = await AsyncStorage.getItem(key(walletId));
  if (!raw) return null;
  return validateAttempt(JSON.parse(raw));
}
function validateAttempt(value: any): PaymentAttempt {
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.sourceId !== 'string'
    || !['pending', 'unknown', 'failed', 'completed'].includes(value.status)
    || typeof value.provider !== 'string' || typeof value.total !== 'string' || typeof value.recipient !== 'string'
    || !Number.isSafeInteger(value.createdAt)
    || ['recipientName', 'feeDisplay', 'accountName', 'destinationRail', 'network', 'detail'].some(field => value[field] !== undefined && typeof value[field] !== 'string')
    || (value.lastCheckedAt !== undefined && !Number.isSafeInteger(value.lastCheckedAt))
    || (value.checkFailed !== undefined && typeof value.checkFailed !== 'boolean')
    || (value.onchainConfirmed !== undefined && typeof value.onchainConfirmed !== 'boolean')
    || (value.dismissedAt !== undefined && !Number.isSafeInteger(value.dismissedAt))) throw new Error('Payment recovery record is unreadable.');
  return value;
}
const archiveKey = (walletId: number) => `kaleidopay-attempts-v2-${walletId}`;
export async function loadPaymentAttempts(walletId: number): Promise<PaymentAttempt[]> {
  const raw = await AsyncStorage.getItem(archiveKey(walletId));
  const archive: PaymentAttempt[] = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(archive)) throw new Error('Payment recovery record is unreadable.');
  archive.forEach(validateAttempt);
  const latest = await loadPaymentAttempt(walletId);
  return latest ? [...archive.filter(a => a.id !== latest.id), latest] : archive;
}
async function archiveAttempt(walletId: number, attempt: PaymentAttempt) {
  const all = await loadPaymentAttempts(walletId);
  await AsyncStorage.setItem(archiveKey(walletId), JSON.stringify([...all.filter(a => a.id !== attempt.id), attempt]));
}
// Serialize journal writes, including status checks and dismissal, per wallet.
const writes = new Map<number, Promise<unknown>>();
function serialized<T>(walletId: number, action: () => Promise<T>): Promise<T> {
  const next = (writes.get(walletId) ?? Promise.resolve()).catch(() => {}).then(action);
  writes.set(walletId, next);
  void next.finally(() => { if (writes.get(walletId) === next) writes.delete(walletId); }).catch(() => {});
  return next;
}
const write = (walletId: number, attempt: PaymentAttempt) => AsyncStorage.setItem(key(walletId), JSON.stringify(attempt));
export const savePaymentAttempt = (walletId: number, attempt: PaymentAttempt) => serialized(walletId, () => write(walletId, attempt));
/** A delayed check cannot replace a newer payment, undo dismissal or downgrade a final result. */
export const updatePaymentAttempt = (walletId: number, attempt: PaymentAttempt): Promise<boolean> => serialized(walletId, async () => {
  const latest = await loadPaymentAttempt(walletId);
  const current = latest?.id === attempt.id ? latest : await loadPaymentAttempt(walletId, attempt.id);
  if (!current || current.id !== attempt.id || current.dismissedAt
    || (['completed', 'failed'].includes(current.status) && current.status !== attempt.status)) return false;
  await (latest?.id === attempt.id ? write : archiveAttempt)(walletId, { ...current, ...attempt, reference: attempt.reference ?? current.reference, ...(current.onchainConfirmed ? { onchainConfirmed: true } : {}) });
  return true;
});
export const unresolvedAttempt = (attempt: PaymentAttempt | null) => !attempt?.dismissedAt && (attempt?.status === 'pending' || attempt?.status === 'unknown');
/**
 * The user's explicit way out when a payment's outcome cannot be determined (or its record is
 * unreadable): it stops blocking new payments. The record is kept, marked dismissed; swap
 * recovery still finishes any swap that is in flight.
 */
export async function dismissPaymentAttempt(walletId: number, attempt: PaymentAttempt | null): Promise<void> {
  await serialized(walletId, async () => {
    if (attempt) {
      const latest = await loadPaymentAttempt(walletId);
      const current = await loadPaymentAttempt(walletId, attempt.id);
      if (current && unresolvedAttempt(current)) await (latest?.id === attempt.id ? write : archiveAttempt)(walletId, { ...current, dismissedAt: Date.now() });
    } else {
      // Clearing a corrupt record must not delete a valid record written meanwhile.
      try { if (await loadPaymentAttempt(walletId)) return; } catch { /* corrupt record */ }
      await AsyncStorage.removeItem(key(walletId));
    }
  });
}

/** Preserve all pending payments; reject duplicate execution of the same attempt. */
export async function beginPaymentAttempt(walletId: number, attempt: PaymentAttempt): Promise<void> {
  await serialized(walletId, async () => {
    const previous = await loadPaymentAttempt(walletId);
    if ((await loadPaymentAttempts(walletId)).some(a => a.id === attempt.id)) throw new Error('This payment has already been started.');
    if (previous) await archiveAttempt(walletId, previous);
    await write(walletId, attempt);
  });
}
