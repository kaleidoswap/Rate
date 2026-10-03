import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PaymentResult } from './index';
export interface PaymentAttempt extends PaymentResult {
  id: string; sourceId: string; provider: string; total: string; recipient: string; createdAt: number;
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
    || (value.dismissedAt !== undefined && !Number.isSafeInteger(value.dismissedAt))) throw new Error('Payment recovery record is unreadable.');
  return value;
}
export const savePaymentAttempt = (walletId: number, attempt: PaymentAttempt) => AsyncStorage.setItem(key(walletId), JSON.stringify(attempt));
export const unresolvedAttempt = (attempt: PaymentAttempt | null) => !attempt?.dismissedAt && (attempt?.status === 'pending' || attempt?.status === 'unknown');
/**
 * The user's explicit way out when a payment's outcome cannot be determined (or its record is
 * unreadable): it stops blocking new payments. The record is kept, marked dismissed; swap
 * recovery still finishes any swap that is in flight.
 */
export async function dismissPaymentAttempt(walletId: number, attempt: PaymentAttempt | null): Promise<void> {
  if (attempt) await savePaymentAttempt(walletId, { ...attempt, dismissedAt: Date.now() });
  else await AsyncStorage.removeItem(key(walletId));
}

const starting = new Set<number>();
/** Serialize even across multiple screen instances; never overwrite an unresolved payment. */
export async function beginPaymentAttempt(walletId: number, attempt: PaymentAttempt): Promise<void> {
  if (starting.has(walletId)) throw new Error('Another payment is starting.');
  starting.add(walletId);
  try {
    if (unresolvedAttempt(await loadPaymentAttempt(walletId))) throw new Error('Check your previous payment before sending again.');
    await savePaymentAttempt(walletId, attempt);
  } finally { starting.delete(walletId); }
}
