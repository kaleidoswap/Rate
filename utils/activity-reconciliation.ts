import type { ActivityItem } from '../services/ActivityService';
/** Match a recovery row only by an exact provider reference on the same account layer. */
export function reconcilePendingActivity(pending: ActivityItem[], feed: ActivityItem[]): ActivityItem[] {
  const matches = (a: ActivityItem, b: ActivityItem) => !!a.txid && b.type === 'send' && a.layer === b.layer
    && [b.txid, b.paymentHash, b.requestId].includes(a.txid);
  const uniqueMatch = (a: ActivityItem) => { const list = feed.filter(b => matches(a, b)); return list.length === 1 ? list[0] : undefined; };
  const recovery = pending.filter(a => { const match = uniqueMatch(a); return !match || !['confirmed', 'failed'].includes(match.status); });
  return [...recovery, ...feed.filter(b => !recovery.some(a => uniqueMatch(a) === b))];
}
