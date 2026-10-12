import type { DepositDetectionStatus } from '../hooks/useDepositDetection';
/** Detection wins over a local expiry timer: a payment already underway must not invite another payment. */
export function receivePresentation(status: DepositDetectionStatus | 'idle' | 'generating', expired: boolean) {
  if (['pending', 'confirmed', 'claimed', 'failed'].includes(status)) return status;
  return expired || status === 'expired' ? 'expired' : 'watching';
}
