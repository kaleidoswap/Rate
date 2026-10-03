import { minimumSwapOutput, quoteHasExpired } from './swap-review';

describe('swap review protection', () => {
  it('uses integer base units for the displayed and submitted 5% minimum', () => {
    expect(minimumSwapOutput(123456, 500)).toBe(117283);
    expect(minimumSwapOutput(100000000, 500)).toBe(95000000);
  });
  it('never submits an unprotected zero minimum for a tiny output', () => {
    expect(minimumSwapOutput(1, 500)).toBe(1);
  });
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid or imprecise outputs: %s', value => {
    expect(() => minimumSwapOutput(value, 500)).toThrow();
  });
  it.each([-1, 10000, NaN, 1.5])('rejects invalid slippage: %s', value => {
    expect(() => minimumSwapOutput(1000, value)).toThrow();
  });
  it('rejects quotes at expiry, including invalid timestamps', () => {
    expect(quoteHasExpired(1000, 999)).toBe(false);
    expect(quoteHasExpired(1000, 1000)).toBe(true);
    expect(quoteHasExpired(NaN)).toBe(true);
  });
});
