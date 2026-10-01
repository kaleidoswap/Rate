import { useEffect } from 'react';
import { useAppSelector } from '../store/hooks';
import { recoverKaleidoPaySwaps } from '../services/kaleidoPay/recovery';

/** On start and on wallet switch, finishes KaleidoPay swaps that a restart interrupted. */
export function KaleidoPayRecovery() {
  const walletId = useAppSelector(s => s.wallet.activeWallet?.id);
  useEffect(() => {
    if (!walletId) return;
    recoverKaleidoPaySwaps()
      .then(done => { if (done.length) console.warn(`KaleidoPay: resumed ${done.length} interrupted swap(s)`); })
      .catch(error => console.warn('KaleidoPay recovery failed', error));
  }, [walletId]);
  return null;
}
