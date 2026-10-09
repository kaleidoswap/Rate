let queue: Promise<unknown> = Promise.resolve();

/** One Agent wallet movement at a time, so two can't both fit under the same limit or balance. */
export function withAgentWalletLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}
