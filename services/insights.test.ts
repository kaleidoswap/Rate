import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  computeInsights, dismissInsight, dismissalStoreKey, loadDismissals, visibleInsights,
  type InsightInput,
} from './insights';
import type { ActivityItem } from './ActivityService';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const NOW = new Date('2026-10-09T12:00:00Z').getTime();
const base = (over: Partial<InsightInput> = {}): InsightInput => ({
  now: NOW, advanced: false, feeRates: null, onchainSat: 0, rgbOnDevice: true, rgbAssetsWithBalance: 0,
  rgbBackup: { state: 'done', lastBackupAt: NOW - 1000 }, channels: [], activity: [], ...over,
});
const item = (over: Partial<ActivityItem>): ActivityItem => ({
  id: 'a', type: 'receive', source: 'payment', asset: 'BTC', assetTicker: 'BTC', assetPrecision: 8, amount: '',
  status: 'confirmed', txid: '', layer: 'LN', timestamp: NOW - 60_000, ...over,
});
const rules = (input: InsightInput) => computeInsights(input).map((i) => i.rule);

describe('insight rules', () => {
  test('a healthy wallet has nothing to say', () => {
    expect(computeInsights(base())).toEqual([]);
  });

  test('a failed RGB backup comes first, with a backup action', () => {
    const [first] = computeInsights(base({ rgbBackup: { state: 'failed' }, feeRates: { fastestFee: 2, halfHourFee: 2, hourFee: 1 }, onchainSat: 5000 }));
    expect(first).toMatchObject({ rule: 'rgb-backup-failed', mood: 'concerned', action: { do: { kind: 'backup-rgb' } } });
  });

  test('RGB assets never backed up', () => {
    expect(rules(base({ rgbAssetsWithBalance: 2, rgbBackup: { state: 'idle' } }))).toEqual(['rgb-backup-missing']);
    expect(rules(base({ rgbAssetsWithBalance: 0, rgbBackup: { state: 'idle' } }))).toEqual([]);
    expect(rules(base({ rgbAssetsWithBalance: 2, rgbBackup: { state: 'backing-up' } }))).toEqual([]);
  });

  test('low fees only with on-chain bitcoin and a cheap rate', () => {
    const low = { fastestFee: 3, halfHourFee: 2, hourFee: 1 };
    expect(rules(base({ feeRates: low, onchainSat: 10_000 }))).toEqual(['low-fees']);
    expect(computeInsights(base({ feeRates: low, onchainSat: 10_000 }))[0]).toMatchObject({ mood: 'happy', action: { do: { kind: 'navigate', screen: 'Send' } } });
    expect(rules(base({ feeRates: low, onchainSat: 0 }))).toEqual([]);
    expect(rules(base({ feeRates: { fastestFee: 30, halfHourFee: 20, hourFee: 10 }, onchainSat: 10_000 }))).toEqual([]);
  });

  test('little inbound room on an RGB channel', () => {
    const tight = [{ assetTicker: 'USDT', localUnits: 95, remoteUnits: 5, usable: true }];
    const [i] = computeInsights(base({ channels: tight }));
    expect(i).toMatchObject({ key: 'inbound-low:USDT', action: { do: { screen: 'LSP' } } });
    expect(i.message).toMatch(/only 5 USDT more/);
    expect(rules(base({ channels: [{ assetTicker: 'USDT', localUnits: 50, remoteUnits: 50, usable: true }] }))).toEqual([]);
    expect(rules(base({ channels: [{ assetTicker: 'USDT', localUnits: 95, remoteUnits: 5, usable: false }] }))).toEqual([]);
  });

  test('channel funds on a node: Advanced only', () => {
    const channels = [{ assetTicker: 'USDT', localUnits: 50, remoteUnits: 50, usable: true }];
    expect(rules(base({ rgbOnDevice: false, channels }))).toEqual([]);
    expect(rules(base({ rgbOnDevice: false, channels, advanced: true }))).toEqual(['channel-state-backup']);
  });

  test('a stuck swap or unconfirmed payment needs attention', () => {
    expect(rules(base({ activity: [item({ type: 'swap', status: 'pending', timestamp: NOW - 20 * 60_000 })] }))).toEqual(['needs-attention']);
    expect(rules(base({ activity: [item({ type: 'swap', status: 'pending', timestamp: NOW - 60_000 })] }))).toEqual([]);
    expect(computeInsights(base({ activity: [item({ id: 'p1', type: 'send', status: 'unknown' })] }))[0]).toMatchObject({
      key: 'needs-attention:p1', title: 'A payment isn’t confirmed yet',
    });
  });

  test('a large payment received in the last day', () => {
    expect(rules(base({ activity: [item({ rawSats: 2_000_000 })] }))).toEqual(['large-incoming']);
    expect(rules(base({ activity: [item({ rawSats: 900_000 })], btcPriceUsd: 60_000 }))).toEqual(['large-incoming']);
    expect(rules(base({ activity: [item({ rawSats: 100_000 })], btcPriceUsd: 60_000 }))).toEqual([]);
    expect(rules(base({ activity: [item({ rawSats: 2_000_000, timestamp: NOW - 2 * 86_400_000 })] }))).toEqual([]);
    expect(rules(base({ activity: [item({ rawSats: 2_000_000, status: 'pending' })] }))).toEqual([]);
  });
});

describe('visibility and dismissals', () => {
  const many = () => computeInsights(base({
    rgbBackup: { state: 'failed' }, feeRates: { fastestFee: 2, halfHourFee: 2, hourFee: 1 }, onchainSat: 5000,
    activity: [item({ id: 'big', rawSats: 3_000_000 }), item({ id: 'u', type: 'send', status: 'unknown' })],
  }));

  test('at most two show, best first', () => {
    expect(visibleInsights(many(), {}, NOW).map((i) => i.rule)).toEqual(['rgb-backup-failed', 'needs-attention']);
  });

  test('a dismissed insight stays hidden for its cooldown, then returns', () => {
    const all = many();
    const shown = visibleInsights(all, { 'rgb-backup-failed': NOW - 3_600_000 }, NOW).map((i) => i.rule);
    expect(shown).toEqual(['needs-attention', 'large-incoming']);
    expect(visibleInsights(all, { 'rgb-backup-failed': NOW - 2 * 86_400_000 }, NOW)[0].rule).toBe('rgb-backup-failed');
  });

  test('dismissals persist per wallet', async () => {
    await AsyncStorage.clear();
    await dismissInsight('1:100', 'low-fees', NOW);
    expect(await loadDismissals('1:100')).toEqual({ 'low-fees': NOW });
    expect(await loadDismissals('2:200')).toEqual({});
    expect(JSON.parse((await AsyncStorage.getItem(dismissalStoreKey('1:100')))!)).toEqual({ 'low-fees': NOW });
    await dismissInsight('1:100', 'rgb-backup-failed', NOW + 1);
    expect(await loadDismissals('1:100')).toEqual({ 'low-fees': NOW, 'rgb-backup-failed': NOW + 1 });
  });

  test('old dismissals are pruned and bad data is ignored', async () => {
    await AsyncStorage.setItem(dismissalStoreKey('w'), JSON.stringify({ old: NOW - 500 * 86_400_000, bad: 'x' }));
    expect(await loadDismissals('w')).toEqual({ old: NOW - 500 * 86_400_000 });
    expect(await dismissInsight('w', 'new', NOW)).toEqual({ new: NOW });
    await AsyncStorage.setItem(dismissalStoreKey('w'), 'not json');
    expect(await loadDismissals('w')).toEqual({});
    expect(await loadDismissals(null)).toEqual({});
  });
});
