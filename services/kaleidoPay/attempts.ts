import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PaymentResult } from './index';
export interface PaymentAttempt extends PaymentResult {
  id: string; sourceId: string; provider: string; total: string; recipient: string; createdAt: number;
  /** Display metadata captured before sending; optional for older records. Never store an invoice or secret. */
  recipientName?: string; feeDisplay?: string; accountName?: string;
  /** Set when the user chose to move on from a payment whose outcome could not be determined. */
  dismissedAt?: number;
}
const key = (walletId: number) => `kaleidopay-attempt-v1-${walletId}`;
export async function loadPaymentAttempt(walletId: number): Promise<PaymentAttempt | null> {
  const raw = await AsyncStorage.getItem(key(walletId));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.sourceId !== 'string'
    || !['pending', 'unknown', 'failed', 'completed'].includes(value.status)
    || typeof value.provider !== 'string' || typeof value.total !== 'string' || typeof value.recipient !== 'string'
    || !Number.isSafeInteger(value.createdAt)
    || ['recipientName', 'feeDisplay', 'accountName'].some(field => value[field] !== undefined && typeof value[field] !== 'string')
    || (value.dismissedAt !== undefined && !Number.isSafeInteger(value.dismissedAt))) throw new Error('Payment recovery record is unreadable.');
  return value;
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
  const current = await loadPaymentAttempt(walletId);
  if (!current || current.id !== attempt.id || current.dismissedAt
    || (['completed', 'failed'].includes(current.status) && current.status !== attempt.status)) return false;
  await write(walletId, { ...current, ...attempt, reference: attempt.reference ?? current.reference });
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
      const current = await loadPaymentAttempt(walletId);
      if (current?.id === attempt.id && unresolvedAttempt(current)) await write(walletId, { ...current, dismissedAt: Date.now() });
    } else {
      // Clearing a corrupt record must not delete a valid record written meanwhile.
      try { if (await loadPaymentAttempt(walletId)) return; } catch { /* corrupt record */ }
      await AsyncStorage.removeItem(key(walletId));
    }
  });
}

/** Serialize even across multiple screen instances; never overwrite an unresolved payment. */
export async function beginPaymentAttempt(walletId: number, attempt: PaymentAttempt): Promise<void> {
  await serialized(walletId, async () => {
    if (unresolvedAttempt(await loadPaymentAttempt(walletId))) throw new Error('Check your previous payment before sending again.');
    await write(walletId, attempt);
  });
}
