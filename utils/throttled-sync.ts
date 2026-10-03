/**
 * Wraps a sync call so concurrent callers share one run and a sync that finished less
 * than `minIntervalMs` ago is not repeated. Failures are not remembered, so the next
 * caller tries again.
 */
export function throttledSync(sync: () => Promise<unknown>, minIntervalMs: number, now: () => number = Date.now) {
  let inFlight: Promise<void> | null = null;
  let lastDone = -Infinity;
  return (): Promise<void> => {
    if (inFlight) return inFlight;
    if (now() - lastDone < minIntervalMs) return Promise.resolve();
    inFlight = Promise.resolve()
      .then(sync)
      .then(() => { lastDone = now(); })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
