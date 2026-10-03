import {
  formatAssetAmount,
  getAssetBaseUnitBalance,
  getAssetDisplayBalance,
  resolvePrecision,
} from './assetAmount';

describe('asset amount helpers', () => {
  it('formats base units with asset precision', () => {
    expect(formatAssetAmount(12_345_000, 6)).toBe('12.345');
    expect(formatAssetAmount(42, 0)).toBe('42');
  });

  it('reads balances from persisted DB numbers and live adapter objects', () => {
    expect(getAssetBaseUnitBalance(25_000_000)).toBe(25_000_000);
    expect(getAssetBaseUnitBalance({ spendable: 12_000_000, settled: 15_000_000 })).toBe(12_000_000);
    expect(getAssetBaseUnitBalance({ available: 7_000_000 })).toBe(7_000_000);
    expect(getAssetBaseUnitBalance({ settled: 3_000_000 })).toBe(3_000_000);
    expect(getAssetBaseUnitBalance(null)).toBe(0);
  });

  it('converts base-unit balances to display units', () => {
    expect(getAssetDisplayBalance(25_000_000, 6)).toBe(25);
    expect(getAssetDisplayBalance({ spendable: 123_456_000 }, 6)).toBe(123.456);
  });
});

describe('resolvePrecision', () => {
  it('keeps a legitimate precision of 0', () => {
    expect(resolvePrecision(0)).toBe(0);
  });

  it('passes through valid precisions', () => {
    expect(resolvePrecision(6)).toBe(6);
  });

  it('falls back only when precision is missing or invalid', () => {
    expect(resolvePrecision(undefined)).toBe(8);
    expect(resolvePrecision(null)).toBe(8);
    expect(resolvePrecision(-1)).toBe(8);
    expect(resolvePrecision(2.5)).toBe(8);
    expect(resolvePrecision(undefined, 2)).toBe(2);
  });
});
