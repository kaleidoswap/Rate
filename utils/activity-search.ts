import type { ActivityItem } from '../services/ActivityService';
export type ActivityPeriod = 'all' | '7d' | '30d' | '90d';
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Whether an item falls inside the chosen period. Undated items only match "all". */
export function matchesActivityPeriod(item: ActivityItem, period: ActivityPeriod, now = Date.now()): boolean {
  if (period === 'all') return true;
  const days = Number(period.slice(0, -1));
  return item.timestamp != null && item.timestamp >= now - days * 86400000 && item.timestamp <= now;
}
export function matchesActivitySearch(item: ActivityItem, query: string, period: ActivityPeriod, now = Date.now()): boolean {
  if (!matchesActivityPeriod(item, period, now)) return false;
  const fields = [item.contactName, item.amount, item.rawSats?.toString(), item.assetTicker, item.assetName,
    item.txid, item.paymentHash, item.requestId, item.account, item.layer, item.crossChain?.recipient];
  const haystack = normalize(fields.filter(Boolean).join(' '));
  return normalize(query).split(/\s+/).every(term => haystack.includes(term) ||
    (/^[\d,.]+$/.test(term) && [item.amount, item.rawSats?.toString()].some(amount => amount?.replace(/[,\s]/g, '').includes(term.replace(/,/g, '')))));
}
