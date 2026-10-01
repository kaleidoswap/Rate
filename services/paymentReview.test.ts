import { estimatePaymentFee, paymentTotal, validFeeSats } from './paymentReview';

const request = { method: 'spark', destination: 'spark-address', amountSats: 1000 };

describe('payment cost review', () => {
  it.each([null, undefined, '', ' ', false, {}, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('never treats invalid fees as free: %s', value => {
    expect(validFeeSats(value)).toBeNull();
  });
  it('preserves an explicitly quoted zero fee and base-unit values', () => {
    expect(validFeeSats(0n)).toBe(0);
    expect(validFeeSats('125')).toBe(125);
  });
  it('does not invent a total when the fee is unknown', () => {
    expect(paymentTotal(1000, null)).toBeNull();
    expect(paymentTotal(1000, 50)).toBe(1050);
  });
  it('only requests a quote, with the exact review amount and destination', async () => {
    const adapter = { quotePaymentFee: jest.fn().mockResolvedValue(42) };
    expect(await estimatePaymentFee(adapter, request)).toBe(42);
    expect(adapter.quotePaymentFee).toHaveBeenCalledWith(request);
    expect(await estimatePaymentFee({}, request)).toBeNull();
  });
  it('leaves unavailable estimates unknown after a bounded wait', async () => {
    jest.useFakeTimers();
    const estimate = estimatePaymentFee({ quotePaymentFee: () => new Promise(() => {}) }, request);
    jest.advanceTimersByTime(15000);
    expect(await estimate).toBeNull();
    jest.useRealTimers();
  });
});
