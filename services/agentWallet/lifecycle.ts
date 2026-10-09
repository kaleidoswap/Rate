// Closes the agent account whenever the wallet it belongs to goes away: another
// wallet becomes active, the wallet is removed or locked, or the app locks.

import { onAppLock } from '../appLockState';

interface WalletStateSource {
  getState(): any;
  subscribe(listener: () => void): () => void;
}

const walletKey = (state: any) => ({
  id: state?.wallet?.activeWallet?.id ?? null,
  unlocked: !!state?.wallet?.isUnlocked,
});

export function watchAgentWalletLifecycle(source: WalletStateSource, close: () => Promise<void>): () => void {
  const closeQuietly = () => { void close().catch(() => {}); };
  let prev = walletKey(source.getState());
  const unsubscribe = source.subscribe(() => {
    const next = walletKey(source.getState());
    if (next.id !== prev.id || (prev.unlocked && !next.unlocked)) closeQuietly();
    prev = next;
  });
  const offLock = onAppLock(closeQuietly);
  return () => { unsubscribe(); offLock(); };
}

/** The live close, loaded on use so this module stays free of wallet imports. */
export async function closeAgentWallet(): Promise<void> {
  const { closeAgentAccount } = await import('./live');
  await closeAgentAccount();
}
