// components/PaymentNotifications.tsx
//
// Headless: keeps "Payment received" notifications working while the app runs.
//  - mirrors the setting for the background task and (un)schedules it;
//  - once Spark is connected, re-links a kaleidoswap.me name after a restore,
//    keeps it pointing at this wallet, and (un)registers this device for pushes;
//  - announces a balance that went up while the app is in the background.
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppSelector } from '../store/hooks';
import { getStoredHandle, linkExistingHandle, refreshTarget } from '../services/kaleidoswapMe';
import {
  recordBalances, scheduleBackgroundPaymentCheck, setPaymentNotificationsEnabled, syncPaymentPush,
} from '../services/paymentNotifications';
import type { Balances, WatchedAccount } from '../utils/paymentWatch';

export default function PaymentNotifications() {
  const walletId = useAppSelector(s => s.wallet?.activeWallet?.id);
  const enabled = useAppSelector(s => s.settings?.transactionNotifications ?? true);
  const byProtocol = useAppSelector(s => s.wallet?.btcBalance?.byProtocol);
  const sparkReady = byProtocol?.SPARK !== undefined;
  const synced = useRef<string | null>(null);

  useEffect(() => {
    void setPaymentNotificationsEnabled(enabled);
    void scheduleBackgroundPaymentCheck(enabled);
  }, [enabled]);

  // kaleidoswap.me: needs Spark connected (it signs with the Spark identity key).
  useEffect(() => {
    if (!walletId || !sparkReady) return;
    const key = `${walletId}:${enabled}`;
    if (synced.current === key) return;
    synced.current = key;
    void (async () => {
      try {
        if (!(await getStoredHandle(walletId))) await linkExistingHandle(walletId);
        else await refreshTarget(walletId).catch(e => console.warn('[kaleidoswap.me] refresh failed', e));
        await syncPaymentPush(walletId, enabled);
      } catch (e) {
        console.warn('[kaleidoswap.me] push sync failed', e);
        synced.current = null; // try again on the next change
      }
    })();
  }, [walletId, sparkReady, enabled]);

  // Balance watch: a balance that went up while we're not in front is a payment.
  useEffect(() => {
    if (!walletId || !byProtocol) return;
    const balances: Balances = {};
    for (const [k, v] of Object.entries(byProtocol)) if (v) balances[k as WatchedAccount] = v.total;
    void recordBalances(walletId, balances, AppState.currentState !== 'active');
  }, [walletId, byProtocol]);

  return null;
}
