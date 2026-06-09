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

// Every protocol whose balance we baseline + watch for an incoming deposit.
const WATCHED_PROTOCOLS: ProtocolName[] = ['RGB', 'SPARK', 'ARKADE', 'LIQUID'];

interface UseDepositDetectionArgs {
  enabled: boolean;
  networkType: string; // 'lightning' | 'onchain' | 'spark' | 'arkade' | 'unified'
  assetId?: string; // RGB asset id, or 'BTC'/undefined for bitcoin
  // Any Lightning (bolt11) invoice currently on screen — the lightning tab's
  // invoice OR the LN leg of the unified QR. When set, its status is polled.
  invoice?: string;
  onDetected: () => void;
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

async function isInvoiceSettled(invoice: string): Promise<boolean> {
  // Only poll a CONNECTED adapter — an unconnected RGB/NWC adapter would otherwise
  // fire an NWC request (synchronous JS-thread crypto + relay timeout) for a node
  // that isn't there.
  const adapter: any = [
    protocolManager.getAdapterIfAvailable('RGB'),
    protocolManager.getAdapterIfAvailable('SPARK'),
  ].find((a: any) => a?.isConnected?.() === true && a?.getInvoiceStatus);
  if (!adapter) return false;
  try {
    const res = await adapter.getInvoiceStatus({ invoice });
    const state = String(res?.state ?? res?.status ?? '').toLowerCase();
    return ['settled', 'paid', 'succeeded', 'complete', 'completed', 'confirmed'].includes(state);
  } catch {
    return false;
  }
}

export function useDepositDetection({
  enabled,
  networkType,
  assetId,
  invoice,
  onDetected,
}: UseDepositDetectionArgs): void {
  // Per-adapter pre-deposit baseline so we only react to a genuine increase.
  const baselinesRef = useRef<Map<ProtocolName, number>>(new Map());
  const firedRef = useRef(false);
  // Keep the latest onDetected without re-subscribing the polling effect.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  // ── Balance watcher: every connected adapter, every leg ──────────────────
  useEffect(() => {
    if (!enabled) {
      baselinesRef.current = new Map();
      firedRef.current = false;
      return;
    }

    let cancelled = false;
    firedRef.current = false;
    baselinesRef.current = new Map();

    const fire = () => {
      if (cancelled || firedRef.current) return;
      firedRef.current = true;
      onDetectedRef.current();
    };

    // Capture baselines up-front for all connected adapters.
    const captureBaselines = async () => {
      for (const { name, adapter } of connectedAdapters()) {
        const v = await readAdapterMetric(adapter, assetId);
        if (cancelled) return;
        if (v != null && !baselinesRef.current.has(name)) baselinesRef.current.set(name, v);
      }
    };

    const tick = async () => {
      if (cancelled || firedRef.current) return;
      for (const { name, adapter } of connectedAdapters()) {
        const current = await readAdapterMetric(adapter, assetId);
        if (cancelled || firedRef.current) return;
        if (current == null) continue;
        const baseline = baselinesRef.current.get(name);
        if (baseline == null) {
          // First time we can read this adapter — record its baseline.
          baselinesRef.current.set(name, current);
          continue;
        }
        if (current > baseline) {
          fire();
          return;
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
      void captureBaselines();
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
      if (await isInvoiceSettled(invoice)) {
        if (cancelled || firedRef.current) return;
        firedRef.current = true;
        onDetectedRef.current();
      }
    };

    // Same deferral as the balance watcher — keep the invoice-status NWC call out
    // of the open burst so the screen is interactive first.
    let id: ReturnType<typeof setInterval> | null = null;
    const startTimer = setTimeout(() => {
      if (cancelled) return;
      id = setInterval(tick, INVOICE_POLL_MS);
    }, INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (id) clearInterval(id);
    };
  }, [enabled, invoice]);
}
