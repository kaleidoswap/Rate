/**
 * Spotting incoming payments from balance changes, for notifications when the
 * app isn't in front. Pure: callers pass the last balances they saw and the new ones.
 */
export type WatchedAccount = 'SPARK' | 'ARKADE' | 'BARK' | 'RGB';
export type Balances = Partial<Record<WatchedAccount, number>>;

export interface Incoming { account: WatchedAccount; sats: number }

const NAMES: Record<WatchedAccount, string> = { SPARK: 'Spark', ARKADE: 'Arkade', BARK: 'Bark', RGB: 'your RGB Lightning node' };
const ORDER: WatchedAccount[] = ['SPARK', 'ARKADE', 'BARK', 'RGB'];

/**
 * Accounts whose balance went up since last time. An account seen for the first
 * time is a baseline, not a payment (connecting an account is not receiving).
 */
export function incomingPayments(prev: Balances | null | undefined, next: Balances): Incoming[] {
  if (!prev) return [];
  return ORDER.flatMap(account => {
    const before = prev[account];
    const after = next[account];
    if (before === undefined || after === undefined) return [];
    const sats = Math.round(after - before);
    return sats > 0 ? [{ account, sats }] : [];
  });
}

/** The baseline to keep: new readings win, accounts not read this time keep their last value. */
export function mergeBalances(prev: Balances | null | undefined, next: Balances): Balances {
  return { ...(prev ?? {}), ...next };
}

const sats = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${n === 1 ? 'sat' : 'sats'}`;

/** "You received 21,000 sats in Spark" (or "… in Spark and 5,000 sats in Arkade"). */
export function describeIncoming(list: Incoming[]): string {
  const parts = list.map(i => `${sats(i.sats)} in ${NAMES[i.account]}`);
  if (parts.length <= 1) return `You received ${parts[0] ?? 'a payment'}`;
  return `You received ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
