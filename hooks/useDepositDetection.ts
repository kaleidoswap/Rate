// hooks/useDepositDetection.ts
//
// Detects an incoming deposit while a receive address / invoice is on screen,
// mirroring rate-extension's useDepositDetection + useInvoiceStatus.
//
// The receive screen's default mode is the "unified" single QR, which embeds
// several payment legs at once (on-chain BTC, Lightning, Spark, Arkade, Liquid).
// A payment can therefore arrive over ANY connected protocol regardless of the
// selected network tab, so detection must watch every leg simultaneously rather
// than a single adapter's balance:
//
//  - Lightning: whenever an LN invoice is on screen (lightning tab OR the LN
//    leg of the unified QR), poll its status (~2s) until it settles.
//  - On-chain / RGB asset / Spark / Arkade / Liquid: snapshot a baseline
//    balance for EVERY connected adapter when the address appears, then poll
//    (~4s) and fire as soon as any adapter's balance rises above its baseline.
//
// All adapter calls are best-effort and wrapped in try/catch — if an adapter
// lacks a method (or errors transiently) we simply skip that probe rather than
// crash the receive screen. Spark single-use on-chain deposits need an explicit
// claim and are handled separately by useSparkAutoClaim.

import { useEffect, useRef } from 'react';
import { protocolManager } from '../services/protocols';

type ProtocolName = 'RGB' | 'SPARK' | 'ARKADE' | 'LIQUID';
export type DepositLayer = 'all' | 'onchain' | 'lightning' | 'rgb' | 'spark' | 'arkade' | 'liquid';
export type DepositDetectionStatus = 'watching' | 'pending' | 'confirmed' | 'claimed' | 'failed' | 'expired';

export interface DepositDetectionEvent {
  layer: DepositLayer;
  status: DepositDetectionStatus;
  protocol?: ProtocolName;
  message?: string;
  rawStatus?: string;
}

// Every protocol whose balance we baseline + watch for an incoming deposit.
const WATCHED_PROTOCOLS: ProtocolName[] = ['RGB', 'SPARK', 'ARKADE', 'LIQUID'];

interface UseDepositDetectionArgs {
  enabled: boolean;
  networkType: string; // 'lightning' | 'onchain' | 'spark' | 'arkade' | 'unified'
  assetId?: string; // RGB asset id, or 'BTC'/undefined for bitcoin
  // Any Lightning (bolt11) invoice currently on screen — the lightning tab's
  // invoice OR the LN leg of the unified QR. When set, its status is polled.
  invoice?: string;
  onDetected: (event?: DepositDetectionEvent) => void;
  onStatus?: (event: DepositDetectionEvent) => void;
}

// Polls run while a receive address/invoice is on screen. They each make adapter
// (node / Spark SDK) calls, so keep them gentle — they compete with the user's
// taps for the JS thread, and a deposit landing a few seconds later is fine.
const BALANCE_POLL_MS = 8000;
const INVOICE_POLL_MS = 4000;
// Hold off the first poll so the screen's open burst (address/invoice generation,
// each an NWC call = synchronous JS-thread crypto) finishes and the UI is
// interactive before we add more adapter calls on top.
const INITIAL_DELAY_MS = 3500;

// Synthetic / non-queryable asset ids that don't map to a real RGB asset
// balance (BTC, the USD aggregator, and the blind "new RGB asset" invoice).
function isBtcLikeAsset(assetId?: string): boolean {
  return !assetId || assetId === 'BTC' || assetId === 'USD' || assetId === 'RGB_NEW';
}

function layerForProtocol(name: ProtocolName, assetId?: string): DepositLayer {
  if (name === 'RGB') return isBtcLikeAsset(assetId) ? 'onchain' : 'rgb';
  if (name === 'SPARK') return 'spark';
  if (name === 'ARKADE') return 'arkade';
  return 'liquid';
}

function connectedAdapters(): Array<{ name: ProtocolName; adapter: any }> {
  const out: Array<{ name: ProtocolName; adapter: any }> = [];
  for (const name of WATCHED_PROTOCOLS) {
    const adapter: any = protocolManager.getAdapterIfAvailable(name);
    // ONLY poll an adapter that is actually connected. RGB is reached over NWC, so
    // calling it while disconnected fires a Nostr request (synchronous JS-thread
    // crypto + a relay round-trip to a node that isn't there) for nothing.
    if (adapter?.isConnected?.() === true) out.push({ name, adapter });
  }
  return out;
}

// Reads a single comparable balance number for `adapter`, or null when it can't
// be read this tick (method missing / transient error / asset unknown here).
async function readAdapterMetric(adapter: any, assetId?: string): Promise<number | null> {
  try {
    if (isBtcLikeAsset(assetId)) {
      const bal = await adapter.getBtcBalance?.();
      if (!bal) return null;
      return Number(bal.total ?? (bal.confirmed ?? 0) + (bal.unconfirmed ?? 0));
    }
    const ab = await adapter.getAssetBalance?.(assetId);
    if (!ab) return null;
    return Number(ab.total ?? ab.future ?? ab.settled ?? ab.spendable ?? 0);
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

function transactionListFromResponse(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.transactions)) return res.transactions;
  if (Array.isArray(res?.payments)) return res.payments;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.transfers)) return res.transfers;
  return [];
}

async function readAdapterTransactions(adapter: any): Promise<any[]> {
  const readers = [adapter.listTransactions, adapter.listPayments, adapter.getTransactions]
    .filter((fn) => typeof fn === 'function')
    .map((fn) => fn.bind(adapter));

  for (const read of readers) {
    try {
      return transactionListFromResponse(await read({ limit: 20 }));
    } catch {
      try {
        return transactionListFromResponse(await read());
      } catch {
        // Try the next optional transaction surface.
      }
    }
  }
  return [];
}

function transactionKey(tx: any, index: number): string | null {
  const key =
    tx?.id ?? tx?.txid ?? tx?.txId ?? tx?.hash ?? tx?.paymentHash ?? tx?.invoice ??
    tx?.payment_hash ?? tx?.transferId ?? tx?.createdAt ?? tx?.timestamp;
  return key == null ? `tx-${index}` : String(key);
}

function transactionStatus(tx: any): DepositDetectionStatus | null {
  return normalizeDepositStatus(tx?.status ?? tx?.state ?? tx?.paymentStatus ?? tx?.transferStatus);
}

function isIncomingTransaction(tx: any): boolean {
  const marker = String(tx?.direction ?? tx?.type ?? tx?.kind ?? '').toLowerCase();
  if (/(send|sent|out|debit|withdraw)/.test(marker)) return false;
  if (/(receive|received|incoming|inbound|deposit|credit)/.test(marker)) return true;
  const amount = Number(tx?.amount ?? tx?.value ?? tx?.sats ?? tx?.amountSats ?? tx?.total ?? 0);
  return amount > 0;
}

async function readInvoiceStatus(invoice: string): Promise<DepositDetectionEvent | null> {
  // Only poll a CONNECTED adapter — an unconnected RGB/NWC adapter would otherwise
  // fire an NWC request (synchronous JS-thread crypto + relay timeout) for a node
  // that isn't there.
  const adapter: any = [
    protocolManager.getAdapterIfAvailable('RGB'),
    protocolManager.getAdapterIfAvailable('SPARK'),
  ].find((a: any) => a?.isConnected?.() === true && a?.getInvoiceStatus);
  if (!adapter) return null;
  try {
    const res = await adapter.getInvoiceStatus({ invoice });
    const rawStatus = res?.state ?? res?.status;
    const status = normalizeDepositStatus(rawStatus);
    return status
      ? { layer: 'lightning', status, rawStatus: String(rawStatus ?? '') }
      : null;
  } catch {
    return null;
  }
}

export function useDepositDetection({
  enabled,
  networkType,
  assetId,
  invoice,
  onDetected,
  onStatus,
}: UseDepositDetectionArgs): void {
  // Per-adapter pre-deposit baseline so we only react to a genuine increase.
  const baselinesRef = useRef<Map<ProtocolName, number>>(new Map());
  const txBaselinesRef = useRef<Map<ProtocolName, Set<string>>>(new Map());
  const firedRef = useRef(false);
  const statusKeyRef = useRef<string | null>(null);
  // Keep the latest onDetected without re-subscribing the polling effect.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  // ── Balance watcher: every connected adapter, every leg ──────────────────
  useEffect(() => {
    if (!enabled) {
      baselinesRef.current = new Map();
      txBaselinesRef.current = new Map();
      firedRef.current = false;
      statusKeyRef.current = null;
      return;
    }

    let cancelled = false;
    firedRef.current = false;
    baselinesRef.current = new Map();
    txBaselinesRef.current = new Map();
    statusKeyRef.current = null;

    const emitStatus = (event: DepositDetectionEvent) => {
      if (cancelled || firedRef.current) return;
      const key = `${event.layer}:${event.status}:${event.protocol ?? ''}:${event.message ?? ''}:${event.rawStatus ?? ''}`;
      if (statusKeyRef.current === key) return;
      statusKeyRef.current = key;
      onStatusRef.current?.(event);
    };

    const fire = (event: DepositDetectionEvent) => {
      if (cancelled || firedRef.current) return;
      firedRef.current = true;
      onDetectedRef.current(event);
    };

    // Capture baselines up-front for all connected adapters.
    const captureBaselines = async () => {
      for (const { name, adapter } of connectedAdapters()) {
        const v = await readAdapterMetric(adapter, assetId);
        if (cancelled) return;
        if (v != null && !baselinesRef.current.has(name)) baselinesRef.current.set(name, v);

        const txs = await readAdapterTransactions(adapter);
        if (cancelled) return;
        if (!txBaselinesRef.current.has(name)) {
          const known = new Set<string>();
          const layer = layerForProtocol(name, assetId);
          txs.forEach((tx, index) => {
            const key = transactionKey(tx, index);
            if (!key) return;
            const status = transactionStatus(tx);
            if (isIncomingTransaction(tx) && status === 'pending') {
              emitStatus({ layer, status: 'pending', protocol: name });
              return;
            }
            known.add(key);
          });
          txBaselinesRef.current.set(name, known);
        }
      }
    };

    const tick = async () => {
      if (cancelled || firedRef.current) return;
      for (const { name, adapter } of connectedAdapters()) {
        const layer = layerForProtocol(name, assetId);
        const current = await readAdapterMetric(adapter, assetId);
        if (cancelled || firedRef.current) return;
        if (current != null) {
          const baseline = baselinesRef.current.get(name);
          if (baseline == null) {
            // First time we can read this adapter — record its baseline.
            baselinesRef.current.set(name, current);
          } else if (current > baseline) {
            fire({ layer, status: 'confirmed', protocol: name });
            return;
          }
        }

        const txs = await readAdapterTransactions(adapter);
        if (cancelled || firedRef.current) return;
        if (!txs.length) continue;
        let known = txBaselinesRef.current.get(name);
        if (!known) {
          known = new Set(txs.map((tx, index) => transactionKey(tx, index)).filter(Boolean) as string[]);
          txBaselinesRef.current.set(name, known);
          continue;
        }

        for (let i = 0; i < txs.length; i += 1) {
          const tx = txs[i];
          const key = transactionKey(tx, i);
          if (!key || known.has(key) || !isIncomingTransaction(tx)) continue;
          const status = transactionStatus(tx);
          if (status === 'pending') {
            emitStatus({ layer, status: 'pending', protocol: name });
          } else if (status === 'confirmed' || status === 'claimed') {
            fire({ layer, status: 'confirmed', protocol: name });
            return;
          } else if (status === 'failed' || status === 'expired') {
            known.add(key);
            emitStatus({ layer, status, protocol: name });
          }
        }
      }
    };

    // Each readAdapterMetric is an adapter call (over NWC for RGB → synchronous
    // Nostr crypto on the JS thread). Capturing baselines across 4 adapters the
    // instant the receive screen mounts piles that crypto onto the open burst and
    // freezes taps. Hold off until the screen has settled and is interactive, THEN
    // baseline + start polling. A deposit can't realistically land in that window.
    let id: ReturnType<typeof setInterval> | null = null;
    const startTimer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        await captureBaselines();
        if (!cancelled) await tick();
      })();
      id = setInterval(tick, BALANCE_POLL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (id) clearInterval(id);
    };
  }, [enabled, networkType, assetId]);

  // ── Lightning watcher: poll the on-screen invoice's status ───────────────
  // Independent of networkType — in unified mode the LN leg has no dedicated
  // tab but still needs watching.
  useEffect(() => {
    if (!enabled || !invoice) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || firedRef.current) return;
      const event = await readInvoiceStatus(invoice);
      if (!event) return;
      if (event.status === 'confirmed') {
        if (cancelled || firedRef.current) return;
        firedRef.current = true;
        onDetectedRef.current(event);
      } else if (event.status === 'pending' || event.status === 'failed' || event.status === 'expired') {
        const key = `${event.layer}:${event.status}:${event.rawStatus ?? ''}`;
        if (statusKeyRef.current !== key) {
          statusKeyRef.current = key;
          onStatusRef.current?.(event);
        }
      }
    };

    // Same deferral as the balance watcher — keep the invoice-status NWC call out
    // of the open burst so the screen is interactive first.
    let id: ReturnType<typeof setInterval> | null = null;
    const startTimer = setTimeout(() => {
      if (cancelled) return;
      void tick();
      id = setInterval(tick, INVOICE_POLL_MS);
    }, INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (id) clearInterval(id);
    };
  }, [enabled, invoice]);
}
