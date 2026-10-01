/** Share identical concurrent work; release arguments (including wallet secrets)
 * as soon as it finishes. Different wallet/configuration calls never share work. */
export function coalesceInFlight<A extends unknown[], R>(task: (...args: A) => Promise<R>) {
  const pending = new Map<string, Promise<R>>();
  return (...args: A): Promise<R> => {
    const key = JSON.stringify(args);
    const existing = pending.get(key);
    if (existing) return existing;
    const result = Promise.resolve().then(() => task(...args)).finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
}
