// services/appLockState.ts
//
// Whether the app lock (components/AppLockGate) is currently open. Services
// that act on the user's behalf from outside the UI flow, such as approving
// NWC payments, check this so nothing can be approved behind the lock screen.
// Starts locked: nothing is approvable until the gate reports it is open.
let unlocked = false;

export function setAppUnlocked(value: boolean): void {
  unlocked = value;
}

export function isAppUnlocked(): boolean {
  return unlocked;
}
