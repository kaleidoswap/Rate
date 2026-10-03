// PersistGate stays closed while migration waits for an explicit retry. Never
// reject into redux-persist: its error path rehydrates defaults and writes them.
let waitingForRetry = false;
let resume: (() => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export const getPersistenceRecoveryState = () => waitingForRetry;
export const subscribePersistenceRecovery = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function retryPersistence() {
  const retry = resume;
  resume = null;
  retry?.();
}

export async function recoverPersistence<T>(operation: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await operation();
    } catch {
      // Install the retry callback before notifying the UI. No secret or native
      // error details belong in the recovery state or logs.
      const retry = new Promise<void>(resolve => { resume = resolve; });
      waitingForRetry = true;
      notify();
      await retry;
      waitingForRetry = false;
      notify();
    }
  }
}
