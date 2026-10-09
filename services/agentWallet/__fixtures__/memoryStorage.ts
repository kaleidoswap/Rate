import type { KeyValueStorage } from '../store';

export function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: async (k) => (k in data ? data[k] : null),
    setItem: async (k, v) => { data[k] = v; },
    removeItem: async (k) => { delete data[k]; },
  };
}
