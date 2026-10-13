import { arkadeBalance } from '../services/protocols/arkadeBalance';
import { normalizeDepositStatus } from '../utils/deposit-status';
import { toEngineProtocol } from '../utils/protocol-bridge'
// Monitor only the receive methods actually encoded in the visible QR.
// Polling is deliberately single-flight: the next cycle is scheduled only after
// every adapter call in the current cycle has completed.

import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { protocolManager } from '../services/protocols';
import {
  callAbortableAdapterMethod,
  receiveMethodsSignature,
  runReceiveOperation,
  type ReceiveMethod,
  type ReceiveProtocol,
} from '../utils/receive-session';
import { decode } from 'light-bolt11-decoder';
import { readBarkOnchain, syncBarkForUpdates } from '../services/BarkService';
import { findRgbReceive, refreshRgbTransfers } from '../services/rgbWallet';
import { rgbReceiveStage } from '../utils/rgb-wallet';

export type DepositLayer = 'all' | 'onchain' | 'lightning' | 'rgb' | 'spark' | 'arkade' | 'bark';
export type DepositDetectionStatus = 'watching' | 'pending' | 'confirmed' | 'claimed' | 'failed' | 'expired';

export interface DepositDetectionEvent {
  layer: DepositLayer;
  status: DepositDetectionStatus;
  protocol?: ReceiveProtocol;
  message?: string;
  rawStatus?: string;
  assetId?: string;
  amount?: number; // atomic units; balance changes may aggregate multiple deposits
  amountSource?: 'balance' | 'payment';
}

interface UseDepositDetectionArgs {
  enabled: boolean;
  methods: ReceiveMethod[];
  onDetected: (event?: DepositDetectionEvent) => void;
  onStatus?: (event: DepositDetectionEvent) => void;
}

const POLL_MS = 8_000;
const INITIAL_DELAY_MS = 0;
const POLL_TIMEOUT_MS = 6_000;
const BARK_SYNC_WAIT_MS = 20_000;
// Moving an RGB transfer forward asks the proxy and the chain: not on every tick.
export const RGB_REFRESH_MS = 15_000;
const RGB_REFRESH_TIMEOUT_MS = 30_000;

/**
 * Bark runs without its daemon, so a receive only shows up (and a Lightning receive is
 * only claimed) after a sync. Bounded so a slow server can't stall the watcher.
 */
async function syncIfBark(method: ReceiveMethod): Promise<void> {
  if (method.protocol !== 'BARK') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    syncBarkForUpdates().catch(() => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, BARK_SYNC_WAIT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

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
  await syncIfBark(method);

  try {
    if (method.protocol === 'BARK' && method.layer === 'onchain') {
      const balance = await runReceiveOperation('Bark on-chain balance', () => readBarkOnchain(), BARK_SYNC_WAIT_MS, parentSignal);
      // Celebrate only confirmed funds; a mempool deposit is not settled.
      return balance.confirmedSats;
    }
    if (!method.assetId || method.assetId === 'BTC' || method.assetId === 'RGB_NEW') {
      const balance = await runReceiveOperation<any>(
        `${method.protocol} receive balance`,
        (signal) => callAbortableAdapterMethod(adapter, 'getBtcBalance', [], signal),
        POLL_TIMEOUT_MS,
        parentSignal,
      );
      if (!balance) return null;
      // Boarding and recoverable funds are not an available Arkade receipt.
      return method.protocol === 'ARKADE' ? Number(balance.confirmed) : Number(balance.total ?? (balance.confirmed ?? 0) + (balance.unconfirmed ?? 0));
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

/** Track USD tokens separately: new token holdings count, BTC changes do not. */
async function readMethodBalances(method: ReceiveMethod, signal: AbortSignal): Promise<Record<string, number> | null> {
  if (method.protocol === 'RGB' && method.layer === 'onchain' && (!method.assetId || method.assetId === 'BTC')) {
    const adapter = getConnectedAdapter(method.protocol);
    if (!adapter) return null;
    try {
      // Native rgb-lib needs a chain sync before reading registerWallet's balance.
      const b = await runReceiveOperation<any>('RGB Bitcoin balance', async () => {
        if (adapter.account?.syncWallet) await adapter.account.syncWallet();
        else await adapter.refreshBalances?.();
        return adapter.getBtcBalance();
      }, POLL_TIMEOUT_MS, signal);
      return { balance: Number(b.confirmed ?? 0), _pending: Number(b.unconfirmed ?? 0) };
    } catch { return null; }
  }
  if (method.protocol === 'ARKADE' && method.layer === 'onchain') {
    const adapter = getConnectedAdapter(method.protocol);
    if (!adapter?.rawWallet) return null;
    try {
      const raw = await runReceiveOperation<any>('Arkade boarding', () => adapter.rawWallet.getBalance(), POLL_TIMEOUT_MS, signal);
      const b = arkadeBalance(raw);
      return { balance: b.available, _boardingPending: b.boardingUnconfirmed, _boardingReady: b.boardingConfirmed };
    } catch { return null; }
  }
  if (method.protocol === 'SPARK' && (method.assetId === 'USD' || method.assetId === 'SPARK_ALL')) {
    const adapter = getConnectedAdapter(method.protocol);
    if (!adapter) return null;
    try {
      const assets = await runReceiveOperation<any[]>('Spark USD balances',
        s => callAbortableAdapterMethod(adapter, 'listAssets', [], s), POLL_TIMEOUT_MS, signal);
      return Object.fromEntries(assets.filter(a => method.assetId === 'SPARK_ALL' || /^usd/i.test(a.ticker ?? ''))
        .map(a => [a.id, Number(a.balance?.total ?? 0)]).filter(([, value]) => Number.isFinite(value)));
    } catch { return null; }
  }
  const balance = await readMethodBalance(method, signal);
  return balance != null && Number.isFinite(balance) ? { balance } : null;
}

/** Payment hash of a BOLT11 invoice, or null if it can't be decoded. */
export function bolt11PaymentHash(invoice: string): string | null {
  try {
    const section = decode(invoice.trim()).sections.find((x: any) => x.name === 'payment_hash') as any;
    return typeof section?.value === 'string' && /^[a-f0-9]{64}$/i.test(section.value) ? section.value : null;
  } catch {
    return null;
  }
}

async function readInvoiceStatus(
  method: ReceiveMethod,
  parentSignal?: AbortSignal,
): Promise<DepositDetectionEvent | null> {
  const adapter = getConnectedAdapter(method.protocol);
  // Adapters without getInvoiceStatus (Bark) report receives by payment hash.
  const paymentHash = !adapter?.getInvoiceStatus && adapter?.getPaymentStatus
    ? bolt11PaymentHash(method.value)
    : null;
  if (!adapter?.getInvoiceStatus && !paymentHash) return null;
  await syncIfBark(method);

  try {
    const result = await runReceiveOperation<any>(
      `${method.protocol} invoice status`,
      (signal) => paymentHash
        ? callAbortableAdapterMethod(adapter, 'getPaymentStatus', [paymentHash], signal)
        : callAbortableAdapterMethod(
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
          assetId: method.assetId ?? 'BTC',
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * An RGB invoice's transfer: refresh it (at most every RGB_REFRESH_MS), then read
 * where it is. Waiting for the sender, waiting for confirmations, settled or failed.
 */
async function readRgbTransfer(
  method: ReceiveMethod,
  lastRefresh: { at: number },
  parentSignal?: AbortSignal,
): Promise<DepositDetectionEvent | null> {
  const adapter = getConnectedAdapter(method.protocol);
  if (!adapter || !method.recipientId) return null;
  try {
    if (Date.now() - lastRefresh.at >= RGB_REFRESH_MS) {
      lastRefresh.at = Date.now();
      await runReceiveOperation('RGB transfer refresh', () => refreshRgbTransfers(adapter), RGB_REFRESH_TIMEOUT_MS, parentSignal)
        .catch(() => undefined); // the last known state still reads
    }
    const assetId = method.assetId && method.assetId !== 'RGB_NEW' ? method.assetId : null;
    const transfer = await runReceiveOperation(
      'RGB transfer status',
      () => findRgbReceive(adapter, { recipientId: method.recipientId!, assetId }),
      RGB_REFRESH_TIMEOUT_MS,
      parentSignal,
    );
    const { stage, message } = rgbReceiveStage(transfer);
    return { layer: method.layer, status: stage, protocol: method.protocol, assetId: method.assetId, amount: transfer?.amount, amountSource: 'payment', message, rawStatus: transfer?.status ?? 'none' };
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
    () => methods.filter((method) => method.monitor === 'balance' || method.monitor === 'invoice' || method.monitor === 'rgb-transfer'),
    [signature],
  );
  const sessionSignatureRef = useRef<string | null>(null);
  const baselinesRef = useRef<Map<string, Record<string, number>>>(new Map());
  const firedRef = useRef(false);
  const statusKeyRef = useRef<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  const onStatusRef = useRef(onStatus);
  onDetectedRef.current = onDetected;
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (sessionSignatureRef.current !== signature) {
      sessionSignatureRef.current = signature;
      baselinesRef.current = new Map();
      firedRef.current = false;
      statusKeyRef.current = null;
    }
    if (!enabled || monitoredMethods.length === 0) return;

    let cancelled = false;
    const operationController = new AbortController();
    let nextTickTimer: ReturnType<typeof setTimeout> | null = null;
    const rgbRefresh = { at: 0 };
    const readStatus = (method: ReceiveMethod) => method.monitor === 'rgb-transfer'
      ? readRgbTransfer(method, rgbRefresh, operationController.signal)
      : readInvoiceStatus(method, operationController.signal);

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
        if (method.monitor !== 'balance' || baselinesRef.current.has(method.key)) continue;
        const balance = await readMethodBalances(method, operationController.signal);
        if (cancelled) return;
        if (balance != null) baselinesRef.current.set(method.key, balance);
      }
    };

    const tick = async () => {
      for (const method of monitoredMethods) {
        if (cancelled || firedRef.current) return;

        if (method.monitor === 'invoice' || method.monitor === 'rgb-transfer') {
          const event = await readStatus(method);
          if (!event) continue;
          if (event.status === 'confirmed' || event.status === 'claimed') {
            fire(event);
            return;
          }
          emitStatus(event);
          continue;
        }

        const balance = await readMethodBalances(method, operationController.signal);
        if (cancelled || firedRef.current || balance == null) continue;
        const baseline = baselinesRef.current.get(method.key);
        if (method.protocol === 'RGB' && method.layer === 'onchain' && balance._pending > 0) {
          emitStatus({ layer: 'onchain', protocol: 'RGB', status: 'pending', assetId: 'BTC', amount: balance._pending,
            message: 'Bitcoin received. Waiting for block confirmation.' });
        }
        if (method.protocol === 'ARKADE' && method.layer === 'onchain' && (balance._boardingPending > 0 || balance._boardingReady > 0)) {
          emitStatus({ layer: method.layer, protocol: 'ARKADE', status: 'pending',
            rawStatus: balance._boardingReady > 0 ? 'boarding_ready' : 'boarding_confirming',
            message: balance._boardingReady > 0 ? 'Bitcoin confirmed. Arkade is preparing the available balance. Keep the app open.' : 'Bitcoin deposit detected. Waiting for block confirmation.' });
        }
        if (baseline == null) {
          baselinesRef.current.set(method.key, balance);
        } else if (Object.entries(balance).some(([asset, value]) => !asset.startsWith('_') && value > (baseline[asset] ?? 0))) {
          const increases = Object.entries(balance).filter(([asset, value]) => !asset.startsWith('_') && value > (baseline[asset] ?? 0));
          const [asset, value] = increases[0];
          fire({
            assetId: increases.length > 1 ? 'MULTIPLE' : asset === 'balance' ? (method.assetId ?? 'BTC') : asset,
            amount: increases.length === 1 ? value - (baseline[asset] ?? 0) : undefined,
            amountSource: 'balance',
            layer: method.layer,
            status: 'confirmed',
            protocol: method.protocol,
          });
          return;
        } else {
          // Follow outgoing funds too, so the next incoming payment is not hidden
          // by spending that happened while this receive request stayed open.
          baselinesRef.current.set(method.key, balance);
        }
      }
    };

    const checkInvoicesOnce = async () => {
      for (const method of monitoredMethods) {
        if (cancelled || firedRef.current || (method.monitor !== 'invoice' && method.monitor !== 'rgb-transfer')) continue;
        const event = await readStatus(method);
        if (!event) continue;
        if (event.status === 'confirmed' || event.status === 'claimed') {
          fire(event);
          return;
        }
        emitStatus(event);
      }
    };

    let running = false;
    let initialized = false;
    let resumeRequested = false;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const run = async () => {
      if (cancelled || firedRef.current || !foreground) return;
      if (running) { resumeRequested = true; return; }
      running = true;
      try {
        if (!initialized) {
          const resuming = baselinesRef.current.size > 0;
          await captureBaselines();
          initialized = true;
          if (resuming) await tick(); else await checkInvoicesOnce();
        } else await tick();
      } finally {
        running = false;
        if (!cancelled && !firedRef.current && foreground) {
          const delay = resumeRequested ? 0 : POLL_MS;
          resumeRequested = false;
          nextTickTimer = setTimeout(() => void run(), delay);
        }
      }
    };
    const startTimer = setTimeout(() => void run(), INITIAL_DELAY_MS);
    const subscription = AppState.addEventListener('change', state => {
      foreground = state === 'active';
      clearTimeout(startTimer);
      if (nextTickTimer) clearTimeout(nextTickTimer);
      // Keep the original baselines across backgrounding so incoming funds are not missed.
      if (foreground) void run();
    });

    return () => {
      cancelled = true;
      subscription.remove();
      operationController.abort(new Error('Deposit monitoring stopped'));
      clearTimeout(startTimer);
      if (nextTickTimer) clearTimeout(nextTickTimer);
    };
  }, [enabled, signature]);
}
