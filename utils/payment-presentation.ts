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
  if (isOnchainPayment(a) && a.status !== 'failed' && a.status !== 'unknown') {
    if (a.onchainConfirmed) return { title: 'Confirmed on-chain', detail: 'Your transaction is included in a Bitcoin block.' };
    if (a.status === 'completed' || (a.reference && ['rgb-btc'].includes(a.sourceId))) {
      return { title: 'Sent to the network', detail: 'Waiting for a Bitcoin block confirmation. Do not send again.' };
    }
    return { title: 'Processing on-chain payment', detail: 'Waiting for the provider to report the transaction. Do not send again.' };
  }
  return a.status === 'completed' ? { title: 'Payment completed', detail: 'Your payment is complete.' }
    : a.status === 'failed' ? { title: 'Payment failed', detail: 'This payment was not sent, or the provider confirmed it failed. Review a new quote before trying again.' }
    : { title: 'Confirming payment', detail: 'Checking automatically. Do not send again.' };
}
