// hooks/useDepositDetection.ts
//
// Detects an incoming deposit while a receive address / invoice is on screen,
// mirroring rate-extension's useDepositDetection + useInvoiceStatus:
//
//  - Lightning invoices: poll the invoice status (~2s) until it settles.
//  - Everything else (on-chain BTC, RGB asset, Spark, Arkade): snapshot a
//    baseline balance when the address appears, then poll (~4s) and fire when
//    the balance rises above the baseline.
//
// All adapter calls are best-effort and wrapped in try/catch — if an adapter
// lacks a method (or errors transiently) we simply skip that tick rather than
// crash the receive screen.

import { useEffect, useRef } from 'react';
import { protocolManager } from '../services/protocols';

type ProtocolName = 'RGB' | 'SPARK' | 'ARKADE';

interface UseDepositDetectionArgs {
  enabled: boolean;
  networkType: string; // 'lightning' | 'onchain' | 'spark' | 'arkade' | 'unified'
  assetId?: string; // RGB asset id, or 'BTC'/undefined for bitcoin
  invoice?: string; // bolt11 invoice when networkType === 'lightning'
  onDetected: () => void;
}

const BALANCE_POLL_MS = 4000;
const INVOICE_POLL_MS = 2000;

function pickAdapter(preferred: ProtocolName) {
  return (
    protocolManager.getAdapterIfAvailable(preferred) ||
    protocolManager.getAdapterIfAvailable('RGB') ||
    protocolManager.getAdapterIfAvailable('SPARK') ||
    protocolManager.getAdapterIfAvailable('ARKADE')
  );
}

// Returns a single comparable number for the relevant balance, or null when it
// can't be read this tick (adapter missing / transient error).
async function readBalanceMetric(networkType: string, assetId?: string): Promise<number | null> {
  const isBtc = !assetId || assetId === 'BTC';
  const preferred: ProtocolName =
    networkType === 'spark' ? 'SPARK' : networkType === 'arkade' ? 'ARKADE' : 'RGB';
  const adapter: any = pickAdapter(preferred);
  if (!adapter) return null;
  try {
    if (isBtc) {
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
  const adapter: any =
    protocolManager.getAdapterIfAvailable('RGB') || protocolManager.getAdapterIfAvailable('SPARK');
  if (!adapter?.getInvoiceStatus) return false;
  try {
    const res = await adapter.getInvoiceStatus({ invoice });
    const state = String(res?.state ?? res?.status ?? '').toLowerCase();
    return ['settled', 'paid', 'succeeded', 'complete', 'completed'].includes(state);
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
  const baselineRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      baselineRef.current = null;
      firedRef.current = false;
      return;
    }

    let cancelled = false;
    firedRef.current = false;
    baselineRef.current = null;

    const isLn = networkType === 'lightning' && !!invoice;

    // Capture the pre-deposit balance so we only react to a genuine increase.
    if (!isLn) {
      void readBalanceMetric(networkType, assetId).then((v) => {
        if (!cancelled) baselineRef.current = v;
      });
    }

    const tick = async () => {
      if (cancelled || firedRef.current) return;

      if (isLn) {
        if (await isInvoiceSettled(invoice as string)) {
          firedRef.current = true;
          if (!cancelled) onDetected();
        }
        return;
      }

      const current = await readBalanceMetric(networkType, assetId);
      if (current == null) return;
      if (baselineRef.current == null) {
        baselineRef.current = current;
        return;
      }
      if (current > baselineRef.current) {
        firedRef.current = true;
        if (!cancelled) onDetected();
      }
    };

    const id = setInterval(tick, isLn ? INVOICE_POLL_MS : BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, networkType, assetId, invoice, onDetected]);
}
