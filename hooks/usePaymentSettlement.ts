// hooks/usePaymentSettlement.ts
//
// Follows a submitted payment to its final state. Some adapters (Bark) return
// before a Lightning payment settles, so the receipt arrives as pending/unknown;
// without this the screen stayed "pending" even after the payment succeeded.
// Polls the adapter's getPaymentStatus(paymentHash) and gives up after a time
// limit, so the UI never spins forever.
import { useEffect, useState } from 'react';
import { protocolManager } from '../services/protocols';
import { toEngineProtocol, type AppProtocol } from '../utils/protocol-bridge';

export type SettlementStatus = 'confirmed' | 'pending' | 'unknown';

export const SETTLEMENT_POLL_MS = 3_000;
export const SETTLEMENT_TIMEOUT_MS = 120_000;

/** Map an adapter PaymentStatus to what the receipt shows. */
export function settlementFromAdapter(raw: any): SettlementStatus | 'failed' | null {
  const status = String(raw?.status ?? '').toLowerCase();
  if (status === 'confirmed' || status === 'succeeded' || status === 'settled' || status === 'paid') return 'confirmed';
  if (status === 'failed') return 'failed';
  if (status === 'pending' || status === 'inprogress' || status === 'in_progress') return 'pending';
  return null;
}

interface Args {
  initialStatus: SettlementStatus;
  protocol?: AppProtocol;
  paymentHash?: string;
}

export function usePaymentSettlement({ initialStatus, protocol, paymentHash }: Args) {
  const [status, setStatus] = useState<SettlementStatus | 'failed'>(initialStatus);
  const [timedOut, setTimedOut] = useState(false);
  const canPoll = initialStatus !== 'confirmed' && !!protocol && !!paymentHash;

  useEffect(() => {
    if (!canPoll) {
      // Nothing to poll: an unsettled receipt is final for this screen.
      if (initialStatus !== 'confirmed') setTimedOut(true);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;

    const check = async () => {
      if (cancelled) return;
      // Deadline first: a lookup that never resolves must not keep the receipt
      // spinning (it would otherwise hold `inFlight` and skip every later tick).
      if (Date.now() >= deadline) {
        cancelled = true;
        clearInterval(id);
        setTimedOut(true);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const adapter: any = protocolManager.getAdapterIfAvailable(toEngineProtocol(protocol!));
        if (!adapter?.getPaymentStatus) return;
        const next = settlementFromAdapter(await adapter.getPaymentStatus(paymentHash));
        if (cancelled || !next) return;
        if (next === 'confirmed' || next === 'failed') {
          cancelled = true;
          clearInterval(id);
          setStatus(next);
        } else if (next === 'pending') {
          setStatus('pending');
        }
      } catch {
        // Transient lookup errors: keep polling until the deadline.
      } finally {
        inFlight = false;
      }
    };

    const id = setInterval(() => { void check(); }, SETTLEMENT_POLL_MS);
    void check();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [canPoll, initialStatus, protocol, paymentHash]);

  return { status, timedOut, polling: canPoll && !timedOut && status !== 'confirmed' && status !== 'failed' };
}
