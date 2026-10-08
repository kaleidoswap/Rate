// The assistant's human-in-the-loop gate, shared by chat and voice: builds the
// readback for a gated tool call, keeps swap quotes fresh while the sheet is
// open, and holds the sheet in "Processing" until the tool returns.
import { useCallback, useRef, useState } from 'react';
import {
  buildConfirmReadback,
  priceChangeWarning,
  requiresStrongAuth,
  swapReadback,
  type ConfirmReadback,
} from '../services/aiConfirm';
import { refreshSwapQuoteForConfirm } from '../services/swapTools';

export interface ConfirmDecision {
  approved: boolean;
  reason?: string;
}
type GatedCall = { name: string; arguments: Record<string, unknown> };

export interface AiConfirmState {
  call: GatedCall;
  readback: ConfirmReadback;
  requireAuth: boolean;
  loading: boolean;
  busyLabel: string | null;
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Could not prepare this action.');

/** Fresh swap terms for the sheet; warns when they moved past the tolerance vs `shown`. */
async function freshSwapReadback(quoteId: string, shown?: number): Promise<{ readback: ConfirmReadback; moved: boolean; refreshed: boolean }> {
  const check = await refreshSwapQuoteForConfirm(quoteId, shown);
  return {
    readback: swapReadback(check.quote, check.needsReapproval ? priceChangeWarning(check.move) : undefined),
    moved: check.needsReapproval,
    refreshed: check.refreshed,
  };
}

export function useAiConfirm(opts: {
  thresholdSats: number;
  /** The sheet opened for a call (voice: speak the readback, pause the mic). */
  onOpen?: (readback: ConfirmReadback) => void;
  onClose?: () => void;
}) {
  const [state, setState] = useState<AiConfirmState | null>(null);
  const stateRef = useRef<AiConfirmState | null>(null);
  const resolver = useRef<((d: ConfirmDecision) => void) | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const update = (next: AiConfirmState | null) => {
    stateRef.current = next;
    setState(next);
  };
  const settle = (d: ConfirmDecision) => {
    resolver.current?.(d);
    resolver.current = null;
  };
  const close = useCallback(() => {
    if (!stateRef.current) return;
    update(null);
    optsRef.current.onClose?.();
  }, []);

  const request = useCallback(async (call: GatedCall): Promise<ConfirmDecision> => {
    settle({ approved: false, reason: 'superseded by a newer request' });
    let readback: ConfirmReadback;
    try {
      readback = await buildConfirmReadback(call);
      if (call.name === 'execute_swap' && readback.quoteId) {
        readback = (await freshSwapReadback(readback.quoteId, readback.shownReceive)).readback;
      }
    } catch (e) {
      return { approved: false, reason: errorText(e) };
    }
    return new Promise<ConfirmDecision>((resolve) => {
      resolver.current = resolve;
      update({
        call,
        readback,
        requireAuth: requiresStrongAuth(readback, optsRef.current.thresholdSats),
        loading: false,
        busyLabel: null,
      });
      optsRef.current.onOpen?.(readback);
    });
  }, []);

  /** The user held to confirm (and passed biometrics/PIN when required). */
  const approve = useCallback(async () => {
    const s = stateRef.current;
    if (!s || s.loading || s.busyLabel) return;
    if (s.call.name === 'execute_swap' && s.readback.quoteId) {
      update({ ...s, busyLabel: 'Checking the price…' });
      try {
        const fresh = await freshSwapReadback(s.readback.quoteId, s.readback.shownReceive);
        if (fresh.moved) {
          update({ ...s, readback: fresh.readback, busyLabel: null });
          optsRef.current.onOpen?.(fresh.readback);
          return;
        }
        update({ ...s, readback: fresh.refreshed ? fresh.readback : s.readback, busyLabel: null, loading: true });
      } catch (e) {
        settle({ approved: false, reason: errorText(e) });
        close();
        return;
      }
    } else {
      update({ ...s, loading: true });
    }
    settle({ approved: true });
  }, [close]);

  const cancel = useCallback(() => {
    if (stateRef.current?.loading) return;
    settle({ approved: false, reason: 'cancelled by user' });
    close();
  }, [close]);

  /** Wire to onToolResult: the approved action finished, drop the sheet. */
  const onToolResult = useCallback((event: { name: string }) => {
    const s = stateRef.current;
    if (s?.loading && s.call.name === event.name) close();
  }, [close]);

  /** The turn ended (or failed): never leave a sheet or a pending promise behind. */
  const reset = useCallback(() => {
    settle({ approved: false, reason: 'turn ended' });
    close();
  }, [close]);

  return { state, request, approve, cancel, onToolResult, reset };
}
