import { useEffect, useState } from 'react';
import { useAppSelector } from '../store/hooks';
import { loadPendingPaymentActivity } from '../services/kaleidoPay/activity';

/**
 * How many payments still need attention (pending or needing a check), for
 * the Activity tab's badge. A light journal read, refreshed about as often
 * as the balance card's own polling.
 */
export function usePendingPaymentsCount(pollMs = 60_000): number {
  const walletId = useAppSelector(state => state.wallet.activeWallet?.id);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    if (walletId == null) { setCount(0); return; }
    const read = () => { void loadPendingPaymentActivity(walletId).then(items => {
      if (active) setCount(items.length);
    }, () => {}); };
    read();
    const timer = setInterval(read, pollMs);
    return () => { active = false; clearInterval(timer); };
  }, [walletId, pollMs]);
  return count;
}
