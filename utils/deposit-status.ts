/** Invoice existence is not evidence that funds have arrived. Unknown states
 * stay unclassified rather than being matched by unsafe substrings ("unpaid"). */
export function normalizeDepositStatus(raw: unknown): 'watching' | 'pending' | 'confirmed' | 'expired' | 'failed' | null {
  const state = String(raw ?? '').trim().toLowerCase();
  if (['settled', 'paid', 'succeeded', 'success', 'complete', 'completed', 'confirmed', 'claimed'].includes(state)) return 'confirmed';
  if (['created', 'open', 'unpaid', 'pending', 'awaiting', 'not_paid', 'unsettled'].includes(state)) return 'watching';
  if (['processing', 'unconfirmed', 'inflight', 'in_flight', 'accepted'].includes(state)) return 'pending';
  if (['expired', 'timeout', 'timed_out'].includes(state)) return 'expired';
  if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(state)) return 'failed';
  return null;
}
