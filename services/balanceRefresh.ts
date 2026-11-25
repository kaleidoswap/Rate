export type BalanceRefreshResult = 'complete' | 'partial' | 'unavailable';

type Refresh = () => Promise<BalanceRefreshResult>;
let source: { walletKey: string; refresh: Refresh } | undefined;

/** Home owns the adapter work. Other screens can request and await that same refresh. */
export function registerBalanceRefresh(walletKey: string, refresh: Refresh): () => void {
  const entry = { walletKey, refresh };
  source = entry;
  return () => { if (source === entry) source = undefined; };
}

export function requestBalanceRefresh(walletKey: string | null): Promise<BalanceRefreshResult> {
  return source && source.walletKey === walletKey ? source.refresh() : Promise.resolve('unavailable');
}
