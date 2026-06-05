jest.mock('react-redux', () => ({ useSelector: jest.fn() }));

import { computeBackupHealth } from './useBackupHealth';

const asset = (balance: number) => ({ balance });

describe('computeBackupHealth', () => {
  it('is OK for a plain-BTC wallet (seed fully recovers it)', () => {
    const h = computeBackupHealth({ rgbAssets: [], channelCount: 0 });
    expect(h.severity).toBe('ok');
    expect(h.seedOnlyInsufficient).toBe(false);
    expect(h.rgbAssetCount).toBe(0);
  });

  it('is OK when RGB assets exist but all balances are zero', () => {
    const h = computeBackupHealth({ rgbAssets: [asset(0), asset(0)], channelCount: 0 });
    expect(h.rgbAssetCount).toBe(2);
    expect(h.rgbAssetsWithBalance).toBe(0);
    expect(h.severity).toBe('ok');
    expect(h.seedOnlyInsufficient).toBe(false);
  });

  it('is INFO when only channels exist (no RGB balance)', () => {
    const h = computeBackupHealth({ rgbAssets: [], channelCount: 2 });
    expect(h.severity).toBe('info');
    expect(h.seedOnlyInsufficient).toBe(true);
    expect(h.channelCount).toBe(2);
  });

  it('WARNS when any RGB asset holds a balance', () => {
    const h = computeBackupHealth({ rgbAssets: [asset(0), asset(10_000_000)], channelCount: 0 });
    expect(h.rgbAssetsWithBalance).toBe(1);
    expect(h.severity).toBe('warning');
    expect(h.seedOnlyInsufficient).toBe(true);
  });

  it('WARNS (RGB takes precedence over channels-only info)', () => {
    const h = computeBackupHealth({ rgbAssets: [asset(5)], channelCount: 3 });
    expect(h.severity).toBe('warning');
  });

  it('handles missing/garbage input defensively', () => {
    // @ts-expect-error testing runtime resilience to undefined
    const h = computeBackupHealth({ rgbAssets: undefined, channelCount: -5 });
    expect(h.rgbAssetCount).toBe(0);
    expect(h.channelCount).toBe(0);
    expect(h.severity).toBe('ok');
  });
});
