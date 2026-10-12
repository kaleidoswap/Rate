import { matchesActivitySearch } from './activity-search';
import type { ActivityItem } from '../services/ActivityService';
const now = Date.UTC(2026, 9, 11, 12);
const item: ActivityItem = { id: 'a', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '25,000', rawSats: 25000, contactName: 'Caffè Alice', txid: 'ref-abc123', status: 'confirmed', layer: 'LN', timestamp: now - 8 * 86400000 };
test('searches names without accents, formatted amounts, reference and combined terms', () => {
  for (const q of ['caffe', 'ALICE', '25000', '25,000', 'abc123', 'alice 25000']) expect(matchesActivitySearch(item, q, 'all', now)).toBe(true);
  expect(matchesActivitySearch(item, 'bob', 'all', now)).toBe(false);
});
test('period filters exclude old or undated events without inventing dates', () => {
  expect(matchesActivitySearch(item, '', '7d', now)).toBe(false);
  expect(matchesActivitySearch(item, '', '30d', now)).toBe(true);
  expect(matchesActivitySearch({ ...item, timestamp: undefined }, '', '7d', now)).toBe(false);
  expect(matchesActivitySearch({ ...item, timestamp: undefined }, '', 'all', now)).toBe(true);
  expect(matchesActivitySearch({ ...item, timestamp: now + 1 }, '', '7d', now)).toBe(false);
});
