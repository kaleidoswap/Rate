import type { PaymentAttempt } from '../services/kaleidoPay/attempts';

export function isOnchainPayment(a: PaymentAttempt): boolean {
  return a.destinationRail?.split(':')[0] === 'btc'
    || ['bark-onchain', 'arkade-onchain', 'rgb-btc'].includes(a.sourceId)
    || a.sourceId.startsWith('spark-wallet-');
}
export function awaitingOnchainConfirmation(a: PaymentAttempt | null): boolean {
  return !!a && isOnchainPayment(a) && a.status === 'completed' && !a.onchainConfirmed;
}
export function paymentPresentation(a: PaymentAttempt): { title: string; detail: string } {
  if (a.status === 'failed' && a.resolution === 'refunded') return { title: 'Swap refunded', detail: a.detail || 'Funds were returned to your wallet. The recipient was not paid.' };
  if (a.sourceId === 'rgb-asset' && a.status === 'pending' && a.reference) {
    return { title: 'RGB transfer in progress', detail: a.detail || 'Waiting for the recipient to accept and Bitcoin to confirm. Keep this wallet open.' };
  }
  if (isOnchainPayment(a) && a.status !== 'failed' && a.status !== 'unknown') {
    if (a.onchainConfirmed) return { title: 'Confirmed on-chain', detail: 'Your transaction is included in a Bitcoin block.' };
    if (a.status === 'completed' || (a.reference && ['rgb-btc'].includes(a.sourceId))) {
      return { title: 'Sent to the network', detail: 'Broadcast. A Bitcoin block will confirm it shortly.' };
    }
    return { title: 'Sending', detail: 'Broadcasting to the Bitcoin network…' };
  }
  return a.status === 'completed' ? { title: 'Payment completed', detail: 'Your payment is complete.' }
    : a.status === 'failed' ? { title: 'Payment failed', detail: a.detail || (a.sourceId === 'rgb-asset' ? 'The RGB transfer failed. Review the transfer details before trying again.' : 'This payment was not sent, or the provider confirmed it failed. Review a new quote before trying again.') }
    : a.status === 'unknown' ? { title: 'Payment outcome unknown', detail: a.detail || 'We have no confirmation that this payment completed. Check again before retrying.' }
    : { title: 'Confirming', detail: 'Checking automatically.' };
}

/** Bound polling to the original attempt, including after app restarts. */
export function paymentPollingRemaining(createdAt: number, now: number, limit: number): number {
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.min(limit, createdAt + limit - now));
}
