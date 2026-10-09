// services/appLockState.ts
//
// Whether the app lock (components/AppLockGate) is currently open. Services
// that act on the user's behalf from outside the UI flow, such as approving
// NWC payments, check this so nothing can be approved behind the lock screen.
// Starts locked: nothing is approvable until the gate reports it is open.
let unlocked = false;
const lockListeners = new Set<() => void>();

export function setAppUnlocked(value: boolean): void {
  const locking = unlocked && !value;
  unlocked = value;
  if (locking) {
    for (const fn of lockListeners) {
      try { fn(); } catch { /* a listener must not keep the app unlocked */ }
    }
  }
}

/** Run `fn` each time the app locks. Returns the unsubscribe function. */
export function onAppLock(fn: () => void): () => void {
  lockListeners.add(fn);
  return () => { lockListeners.delete(fn); };
}

export function isAppUnlocked(): boolean {
  return unlocked;
}
