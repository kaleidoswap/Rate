import { reconcilePendingActivity } from './activity-reconciliation';
import type { ActivityItem } from '../services/ActivityService';
const recovery = { id: 'attempt', type: 'send', txid: 'hash', layer: 'Spark', status: 'unknown' } as ActivityItem;
test('keeps recovery access while pending, then replaces it with the provider receipt', () => {
  const provider = { ...recovery, id: 'provider', status: 'pending' } as ActivityItem;
  expect(reconcilePendingActivity([recovery], [provider])).toEqual([recovery]);
  const done = { ...provider, status: 'confirmed' } as ActivityItem;
  expect(reconcilePendingActivity([recovery], [done])).toEqual([done]);
});
test('does not combine distinct networks, incoming transfers or missing references', () => {
  for (const other of [{ ...recovery, layer: 'Bark' }, { ...recovery, type: 'receive' }, { ...recovery, txid: '' }]) {
    expect(reconcilePendingActivity([recovery], [other as ActivityItem])).toHaveLength(2);
  }
});
