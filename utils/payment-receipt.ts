export type ReceiptStatus = 'confirmed' | 'pending' | 'unknown';
/** A returned object alone is not evidence that funds have settled. */
export function paymentReceiptStatus(result: any, onchain = false): ReceiptStatus {
  const status = String(result?.status ?? '').toLowerCase();
  if (result?.error || ['failed', 'failure', 'rejected'].includes(status)) throw new Error(result?.error || 'The wallet reported a failed payment.');
  if (['completed', 'complete', 'confirmed', 'succeeded', 'success', 'settled'].includes(status)) return 'confirmed';
  if (['pending', 'processing', 'in_flight', 'broadcast', 'tx_broadcasted', 'submitted'].includes(status)) return 'pending';
  if (status === 'unknown') return 'unknown';
  if (onchain && (result?.txid || result?.txId)) return 'pending';
  if (result?.preimage) return 'confirmed';
  return 'unknown';
}
