import AsyncStorage from '@react-native-async-storage/async-storage';
import { findProof, parseProofs, proofFromResult, upsertProof, type PaymentProof } from '../utils/payment-proofs';

// A preimage only becomes known once the payment has settled, when it is a
// receipt rather than a secret, so plain storage is fine.
const KEY = 'ln-payment-proofs-v1';

let queue: Promise<unknown> = Promise.resolve();

export async function loadPaymentProofs(): Promise<PaymentProof[]> {
  try {
    return parseProofs(await AsyncStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function savePaymentProof(result: unknown): Promise<void> {
  const proof = proofFromResult(result, Date.now());
  if (!proof) return Promise.resolve();
  const run = queue.then(async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(upsertProof(await loadPaymentProofs(), proof)));
  });
  queue = run.catch(() => {});
  return run.catch((e) => console.warn('Payment proofs: save failed', e));
}

export async function findPaymentProof(keys: Array<string | undefined>): Promise<PaymentProof | null> {
  return findProof(await loadPaymentProofs(), keys);
}

/**
 * Keep the preimage of every payment this account makes, whichever screen or
 * tool paid. Some accounts only learn it once the payment settles, so status
 * checks are watched too. The adapter itself is returned, patched in place.
 */
export function withPaymentProofs<T extends object>(adapter: T): T {
  const a = adapter as any;
  if (!a || a.__paymentProofs) return adapter;
  for (const method of ['sendPayment', 'getPaymentStatus'] as const) {
    const original = a[method];
    if (typeof original !== 'function') continue;
    a[method] = async function (...args: unknown[]) {
      const result = await original.apply(this, args);
      void savePaymentProof(result);
      return result;
    };
  }
  a.__paymentProofs = true;
  return adapter;
}
