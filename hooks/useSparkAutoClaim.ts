// hooks/useSparkAutoClaim.ts
//
// Spark on-chain (L1) deposits land at a single-use deposit address and must be
// CLAIMED into the wallet before they show up in the balance — a plain balance
// poll never sees them. This mirrors rate-extension's useSparkAutoClaim:
//
//   1. One-shot SWEEP when the receive screen mounts with a Spark on-chain
//      address — recovers any confirmed deposits made to addresses from earlier
//      sessions (adapter.sweepL1Deposits()).
//   2. Continuous CLAIM polling (~10s) of the address currently on screen
//      (adapter.claimL1Deposit(address)); stops once a deposit is claimed.
//
// Both adapter methods are optional (only SparkWdkAdapter implements them) and
// every call is best-effort — a missing method or transient error just skips
// the tick. On a successful claim/sweep we fire onClaimed() so the screen can
// show the deposit-success overlay and refresh balances.

import { useEffect, useRef } from 'react';
import { protocolManager } from '../services/protocols';

// The new optional claim/sweep surface on the Spark adapter. Typed locally
// because rate resolves @kaleidorg/wallet-engine's *published* types (which may
// lag the local build that actually runs); the methods exist at runtime.
type SparkClaimAdapter = {
  isConnected?: () => boolean;
  claimL1Deposit?: (address: string) => Promise<{
    status: 'awaiting' | 'claimed' | 'error';
    txids?: string[];
    error?: string;
  }>;
  sweepL1Deposits?: () => Promise<{
    addressesChecked: number;
    claimedTxids: string[];
    errors: string[];
  }>;
};

interface UseSparkAutoClaimArgs {
  // The Spark single-use BTC L1 deposit address currently shown, or null when
  // the on-screen receive isn't a Spark on-chain deposit.
  address: string | null;
  enabled: boolean;
  onClaimed: () => void;
}

const CLAIM_POLL_MS = 10_000;

function getSparkAdapter(): SparkClaimAdapter | null {
  return (protocolManager.getAdapterIfAvailable('SPARK') as unknown as SparkClaimAdapter) || null;
}

export function useSparkAutoClaim({ address, enabled, onClaimed }: UseSparkAutoClaimArgs): void {
  // Address we've already claimed (stop polling it) and the address we've swept.
  const claimedRef = useRef<string | null>(null);
  const sweptRef = useRef<string | null>(null);

  const active = enabled && !!address && claimedRef.current !== address;

  // One-shot sweep when a Spark on-chain address first appears.
  useEffect(() => {
    if (!active || !address) return;
    if (sweptRef.current === address) return;
    sweptRef.current = address;

    let cancelled = false;
    void (async () => {
      const adapter = getSparkAdapter();
      if (!adapter?.sweepL1Deposits) return;
      try {
        const res = await adapter.sweepL1Deposits();
        if (!cancelled && res.claimedTxids.length > 0) onClaimed();
      } catch (err) {
        console.warn('Spark deposit sweep failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, address, onClaimed]);

  // Continuous claim polling of the on-screen address.
  useEffect(() => {
    if (!active || !address) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const adapter = getSparkAdapter();
      if (!adapter?.claimL1Deposit) return;
      try {
        const res = await adapter.claimL1Deposit(address);
        if (!cancelled && res.status === 'claimed') {
          claimedRef.current = address;
          clearInterval(id);
          onClaimed();
        }
      } catch (err) {
        console.warn('Spark auto-claim poll failed:', err);
      }
    };

    const id = setInterval(tick, CLAIM_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, address, onClaimed]);
}
