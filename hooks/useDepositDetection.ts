import { toEngineProtocol } from '../utils/protocol-bridge'
// Monitor only the receive methods actually encoded in the visible QR.
// Polling is deliberately single-flight: the next cycle is scheduled only after
// every adapter call in the current cycle has completed.

import { useEffect, useMemo, useRef } from 'react';
import { protocolManager } from '../services/protocols';
import {
  callAbortableAdapterMethod,
  receiveMethodsSignature,
  runReceiveOperation,
  type ReceiveMethod,
  type ReceiveProtocol,
} from '../utils/receive-session';

export type DepositLayer = 'all' | 'onchain' | 'lightning' | 'rgb' | 'spark' | 'arkade' | 'liquid';
export type DepositDetectionStatus = 'watching' | 'pending' | 'confirmed' | 'claimed' | 'failed' | 'expired';

export interface DepositDetectionEvent {
  layer: DepositLayer;
  status: DepositDetectionStatus;
  protocol?: ReceiveProtocol;
  message?: string;
  rawStatus?: string;
}

interface UseDepositDetectionArgs {
  enabled: boolean;
  methods: ReceiveMethod[];
  onDetected: (event?: DepositDetectionEvent) => void;
  onStatus?: (event: DepositDetectionEvent) => void;
}

const POLL_MS = 8_000;
const INITIAL_DELAY_MS = 4_000;
const POLL_TIMEOUT_MS = 6_000;

function getConnectedAdapter(protocol: ReceiveProtocol): any | null {
  const adapter: any = protocolManager.getAdapterIfAvailable(toEngineProtocol(protocol));
  return adapter?.isConnected?.() === true ? adapter : null;
}

async function readMethodBalance(
  method: ReceiveMethod,
  parentSignal?: AbortSignal,
): Promise<number | null> {
  const adapter = getConnectedAdapter(method.protocol);
  if (!adapter) return null;

  try {
    if (!method.assetId || method.assetId === 'BTC' || method.assetId === 'USD' || method.assetId === 'RGB_NEW') {
      const balance = await runReceiveOperation<any>(
        `${method.protocol} receive balance`,
        (signal) => callAbortableAdapterMethod(adapter, 'getBtcBalance', [], signal),
        POLL_TIMEOUT_MS,
        parentSignal,
      );
      if (!balance) return null;
      return Number(balance.total ?? (balance.confirmed ?? 0) + (balance.unconfirmed ?? 0));
    }

    const balance = await runReceiveOperation<any>(
      `${method.protocol} ${method.assetId} receive balance`,
      (signal) => callAbortableAdapterMethod(
        adapter,
        'getAssetBalance',
        [method.assetId],
        signal,
      ),
      POLL_TIMEOUT_MS,
      parentSignal,
    );
    if (!balance) return null;
    return Number(balance.total ?? balance.future ?? balance.settled ?? balance.spendable ?? 0);
  } catch {
    return null;
  }
}

function normalizeDepositStatus(raw: unknown): DepositDetectionStatus | null {
  const state = String(raw ?? '').trim().toLowerCase();
  if (!state) return null;
  if (['settled', 'paid', 'succeeded', 'success', 'complete', 'completed', 'confirmed', 'claimed'].includes(state)) {
    return 'confirmed';
  }
  if (['pending', 'processing', 'created', 'open', 'unpaid', 'unconfirmed', 'awaiting', 'inflight'].includes(state)) {
    return 'pending';
  }
  if (['expired', 'timeout', 'timed_out'].includes(state)) return 'expired';
  if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(state)) return 'failed';
  if (state.includes('unconfirm') || state.includes('not_confirm')) return 'pending';
  if (state.includes('confirm') || state.includes('settle') || state.includes('paid')) return 'confirmed';
  if (state.includes('pending') || state.includes('await') || state.includes('process') || state.includes('open')) return 'pending';
  if (state.includes('expir')) return 'expired';
  if (state.includes('fail') || state.includes('cancel') || state.includes('reject')) return 'failed';
  return null;
}

async function readInvoiceStatus(
  method: ReceiveMethod,
  parentSignal?: AbortSignal,
): Promise<DepositDetectionEvent | null> {
  const adapter = getConnectedAdapter(method.protocol);
  if (!adapter?.getInvoiceStatus) return null;

  try {
    const result = await runReceiveOperation<any>(
      `${method.protocol} invoice status`,
      (signal) => callAbortableAdapterMethod(
        adapter,
        'getInvoiceStatus',
        [{ invoice: method.value }],
        signal,
      ),
      POLL_TIMEOUT_MS,
      parentSignal,
    );
    const rawStatus = result?.state ?? result?.status;
    const status = normalizeDepositStatus(rawStatus);
    return status
      ? {
          layer: method.layer,
          status,
          protocol: method.protocol,
          rawStatus: String(rawStatus ?? ''),
        }
      : null;
  } catch {
    return null;
  }
}

export function useDepositDetection({
  enabled,
  methods,
  onDetected,
  onStatus,
}: UseDepositDetectionArgs): void {
  const signature = receiveMethodsSignature(methods);
  const monitoredMethods = useMemo(
    () => methods.filter((method) => method.monitor === 'balance' || method.monitor === 'invoice'),
    [signature],
  );
  const baselinesRef = useRef<Map<string, number>>(new Map());
  const firedRef = useRef(false);
  const statusKeyRef = useRef<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  const onStatusRef = useRef(onStatus);
  onDetectedRef.current = onDetected;
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!enabled || monitoredMethods.length === 0) {
      baselinesRef.current = new Map();
      firedRef.current = false;
      statusKeyRef.current = null;
      return;
    }

    let cancelled = false;
    const operationController = new AbortController();
    let nextTickTimer: ReturnType<typeof setTimeout> | null = null;
    firedRef.current = false;
    baselinesRef.current = new Map();
    statusKeyRef.current = null;

    const emitStatus = (event: DepositDetectionEvent) => {
      if (cancelled || firedRef.current) return;
      const key = `${event.layer}:${event.status}:${event.protocol ?? ''}:${event.rawStatus ?? ''}`;
      if (statusKeyRef.current === key) return;
      statusKeyRef.current = key;
      onStatusRef.current?.(event);
    };

    const fire = (event: DepositDetectionEvent) => {
      if (cancelled || firedRef.current) return;
      firedRef.current = true;
      onDetectedRef.current(event);
    };

    const captureBaselines = async () => {
      for (const method of monitoredMethods) {
        if (cancelled) return;
        if (method.monitor !== 'balance') continue;
        const balance = await readMethodBalance(method, operationController.signal);
        if (cancelled) return;
        if (balance != null) baselinesRef.current.set(method.key, balance);
      }
    };

    const tick = async () => {
      for (const method of monitoredMethods) {
        if (cancelled || firedRef.current) return;

        if (method.monitor === 'invoice') {
          const event = await readInvoiceStatus(method, operationController.signal);
          if (!event) continue;
          if (event.status === 'confirmed' || event.status === 'claimed') {
            fire(event);
            return;
          }
          emitStatus(event);
          continue;
        }

        const balance = await readMethodBalance(method, operationController.signal);
        if (cancelled || firedRef.current || balance == null) continue;
        const baseline = baselinesRef.current.get(method.key);
        if (baseline == null) {
          baselinesRef.current.set(method.key, balance);
        } else if (balance > baseline) {
          fire({
            layer: method.layer,
            status: 'confirmed',
            protocol: method.protocol,
          });
          return;
        }
      }
    };

    const checkInvoicesOnce = async () => {
      for (const method of monitoredMethods) {
        if (cancelled || firedRef.current || method.monitor !== 'invoice') continue;
        const event = await readInvoiceStatus(method, operationController.signal);
        if (!event) continue;
        if (event.status === 'confirmed' || event.status === 'claimed') {
          fire(event);
          return;
        }
        emitStatus(event);
      }
    };

    const scheduleTick = () => {
      nextTickTimer = setTimeout(() => {
        if (cancelled || firedRef.current) return;
        void tick().finally(() => {
          if (!cancelled && !firedRef.current) scheduleTick();
        });
      }, POLL_MS);
    };

    const startTimer = setTimeout(() => {
      if (cancelled) return;
      void captureBaselines().then(checkInvoicesOnce).finally(() => {
        if (!cancelled && !firedRef.current) scheduleTick();
      });
    }, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      operationController.abort(new Error('Deposit monitoring stopped'));
      clearTimeout(startTimer);
      if (nextTickTimer) clearTimeout(nextTickTimer);
    };
  }, [enabled, signature]);
}
