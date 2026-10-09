import { watchAgentWalletLifecycle } from './lifecycle';
import { setAppUnlocked } from '../appLockState';

function fakeStore(initial: any) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    set(next: any) { state = next; listeners.forEach((fn) => fn()); },
  };
}
const walletState = (id: number | null, isUnlocked = true) => ({ wallet: { activeWallet: id ? { id } : null, isUnlocked } });

describe('agent wallet lifecycle', () => {
  afterEach(() => setAppUnlocked(false));

  it('closes the agent account on wallet switch, removal and wallet lock, not on other changes', () => {
    const store = fakeStore(walletState(1));
    const close = jest.fn(async () => {});
    const stop = watchAgentWalletLifecycle(store, close);
    store.set({ ...walletState(1), other: 'change' });
    expect(close).not.toHaveBeenCalled();
    store.set(walletState(2));
    expect(close).toHaveBeenCalledTimes(1);
    store.set(walletState(2, false));
    expect(close).toHaveBeenCalledTimes(2);
    store.set(walletState(null, false));
    expect(close).toHaveBeenCalledTimes(3);
    stop();
    store.set(walletState(5));
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('closes it when the app locks', () => {
    const close = jest.fn(async () => {});
    const stop = watchAgentWalletLifecycle(fakeStore(walletState(1)), close);
    setAppUnlocked(true);
    expect(close).not.toHaveBeenCalled();
    setAppUnlocked(false);
    expect(close).toHaveBeenCalledTimes(1);
    stop();
    setAppUnlocked(true);
    setAppUnlocked(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a failing close never throws into the store', () => {
    const store = fakeStore(walletState(1));
    watchAgentWalletLifecycle(store, async () => { throw new Error('x'); });
    expect(() => store.set(walletState(2))).not.toThrow();
  });
});
