import { isMempoolNetwork, MempoolClient } from '../mempool/MempoolClient';
import type { PaymentAttempt } from './attempts';
import { isOnchainPayment } from '../../utils/payment-presentation';

/** A provider's completed send is not proof of block inclusion. Never resubmits. */
export async function checkOnchainConfirmation(attempt: PaymentAttempt): Promise<PaymentAttempt> {
  if ((attempt.status !== 'completed' && !(attempt.sourceId === 'rgb-btc' && attempt.status === 'pending'))
    || !isOnchainPayment(attempt) || attempt.onchainConfirmed
    || !attempt.reference || !/^[a-f0-9]{64}$/i.test(attempt.reference) || !isMempoolNetwork(attempt.network)) return attempt;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const client = new MempoolClient(attempt.network, (url, init) => fetch(url, { ...init, signal: controller.signal }));
    const status = await client.getTxStatus(attempt.reference);
    return status.confirmed ? { ...attempt, status: 'completed', onchainConfirmed: true } : attempt;
  } catch { return attempt; } finally { clearTimeout(timer); } // An unavailable explorer cannot prove success or failure.
}
