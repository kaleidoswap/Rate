import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { rgbAccountAdapter } from '../services/protocols';
import { listRgbTransfers, refreshRgbTransfers } from '../services/rgbWallet';
import { hasPendingRgbTransfers, rgbTransfersSignature, rgbWalletSupport, startPolling, type RgbTransfer } from '../utils/rgb-wallet';

export const RGB_WATCH_INTERVAL_MS = 15_000;

/**
 * While the screen is focused and the app is in front, moves the RGB account's
 * pending transfers forward and re-reads this asset's, every RGB_WATCH_INTERVAL_MS,
 * until none is pending. `onChange` runs when any transfer's status changed.
 */
export function useRgbTransferWatch({ assetId, enabled, onChange }: {
  assetId: string;
  enabled: boolean;
  onChange?: () => void;
}): RgbTransfer[] {
  const [transfers, setTransfers] = useState<RgbTransfer[]>([]);
  const [active, setActive] = useState((AppState?.currentState ?? 'active') === 'active');
  const signature = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const sub = AppState?.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub?.remove();
  }, []);

  useFocusEffect(useCallback(() => {
    if (!enabled || !active) return undefined;
    let live = true;
    const tick = async (): Promise<boolean> => {
      const adapter: any = rgbAccountAdapter();
      if (!rgbWalletSupport(adapter).listTransfers) return false;
      await refreshRgbTransfers(adapter).catch(() => undefined);
      const list = await listRgbTransfers(adapter, assetId);
      if (!live) return false;
      const next = rgbTransfersSignature(list);
      if (signature.current !== null && signature.current !== next) onChangeRef.current?.();
      signature.current = next;
      setTransfers(list);
      return hasPendingRgbTransfers(list);
    };
    const stop = startPolling({ tick, intervalMs: RGB_WATCH_INTERVAL_MS });
    return () => { live = false; stop(); };
  }, [assetId, enabled, active]));

  return transfers;
}
