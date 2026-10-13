import { reconcileOtherPayments } from '../services/kaleidoPay/pendingPayments';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loadBtcBalance } from '../store/slices/walletSlice';
import { reconcileArkadePayment } from '../services/kaleidoPay/arkadeRecovery';
export function useArkadePaymentRecovery() {
  const walletId = useAppSelector(s => s.wallet.activeWallet?.id);
  const unlocked = useAppSelector(s => s.wallet.isUnlocked);
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!walletId || !unlocked) return;
    let active = true; let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive'; let running = false;
    const run = async () => {
      if (!active || !foreground || running) return;
      running = true;
      try {
        const current = () => active && foreground;
        const arkadeChanged = await reconcileArkadePayment(walletId, current);
        const othersChanged = current() && await reconcileOtherPayments(walletId, current);
        if (current() && (arkadeChanged || othersChanged)) void dispatch(loadBtcBalance());
      }
      catch { /* Recovery stays pending. No retry ever resends the payment. */ }
      finally { running = false; }
    };
    void run(); const timer = setInterval(() => void run(), 15000);
    const subscription = AppState.addEventListener('change', state => { foreground = state === 'active'; if (foreground) void run(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [walletId, unlocked, dispatch]);
}
