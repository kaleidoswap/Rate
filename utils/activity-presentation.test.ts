import { activityAmountIsIncoming, activityAmountPrefix, activityIcon, activityShortTime, activityTypeLabel, activityToneColor } from './activity-presentation';
import type { ActivityItem } from '../services/ActivityService';

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'i1', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0,
  amount: '1,000', status: 'confirmed', txid: 't1', layer: 'LN', ...over,
});

test('one type name serves rows, widgets and sheets', () => {
  expect(activityTypeLabel(item())).toBe('Payment');
  expect(activityTypeLabel(item({ type: 'receive' }))).toBe('Received');
  expect(activityTypeLabel(item({ type: 'swap' }))).toBe('Swap');
  expect(activityTypeLabel(item({ type: 'issuance' }))).toBe('Issuance');
  expect(activityTypeLabel(item({ type: 'issuance', kind: 'Inflation' }))).toBe('Inflation');
  expect(activityTypeLabel(item({ kind: 'unilateral_exit' }))).toBe('Exit to Bitcoin');
  expect(activityTypeLabel(item({ crossChain: { direction: 'deposit' } as ActivityItem['crossChain'] }))).toBe('Deposit from another chain');
  expect(activityTypeLabel(item({ crossChain: { direction: 'send' } as ActivityItem['crossChain'] }))).toBe('Sent to another chain');
});

test('money in carries + and reads green; swaps stay neutral and unsigned', () => {
  expect(activityAmountPrefix('receive')).toBe('+');
  expect(activityAmountPrefix('issuance')).toBe('+');
  expect(activityAmountPrefix('send')).toBe('−');
  expect(activityAmountPrefix('swap')).toBe('');
  expect(activityAmountPrefix('channel_open')).toBe('');
  expect(activityAmountIsIncoming('receive')).toBe(true);
  expect(activityAmountIsIncoming('swap')).toBe(false);
});

test('the icon set is the same everywhere', () => {
  expect(activityIcon('receive').icon).toBe('arrow-down');
  expect(activityIcon('send').tone).toBe('sent');
  expect(activityIcon('swap').icon).toBe('swap-horizontal');
  expect(activityToneColor('receive', { colors: { tx: { receive: '#1', sent: '#2', swap: '#3' }, accent: { 500: '#4' }, warning: { 500: '#5' }, text: { tertiary: '#6' } } })).toBe('#1');
});

test('rows tell one compact age: now, minutes, hours, days, then a date', () => {
  const now = 1_700_000_000_000;
  expect(activityShortTime(undefined, now)).toBe('');
  expect(activityShortTime(now - 30_000, now)).toBe('now');
  expect(activityShortTime(now - 5 * 60_000, now)).toBe('5m');
  expect(activityShortTime(now - 3 * 3_600_000, now)).toBe('3h');
  expect(activityShortTime(now - 3 * 86_400_000, now)).toBe('3d');
  const old = now - 30 * 86_400_000;
  expect(activityShortTime(old, now)).toBe(new Date(old).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
});
