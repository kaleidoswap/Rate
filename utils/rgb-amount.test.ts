import { parseRgbReceiveAmount, rgbAmountUnits } from './rgb-amount';
test.each([['1,25', 2, 125], ['1.25', 6, 1250000], ['25', 0, 25], ['0.000001', 6, 1]])('parses %s exactly', (text, precision, expected) => {
  expect(rgbAmountUnits(text, precision)).toBe(expected);
});
test.each(['0', '-1', '1e3', '1.234', 'NaN', '1,2.3', '9007199254740992'])('rejects invalid or inexact amount %s', text => {
  expect(rgbAmountUnits(text, 2)).toBeUndefined();
});

describe('parseRgbReceiveAmount', () => {
  it('keeps a cleared input open and uses the selected asset precision', () => {
    expect(parseRgbReceiveAmount(' ', 2)).toEqual({ kind: 'open' });
    expect(parseRgbReceiveAmount('1,25', 6)).toEqual({ kind: 'fixed', amount: 1_250_000 });
    expect(parseRgbReceiveAmount('.05', 2)).toEqual({ kind: 'fixed', amount: 5 });
    expect(parseRgbReceiveAmount('90071992547409.91', 2)).toEqual({ kind: 'fixed', amount: Number.MAX_SAFE_INTEGER });
  });

  it('rejects nonblank inputs that cannot be represented as a positive exact amount', () => {
    for (const input of ['0', '1.005', '1.', '-1', '1e3', '90071992547409.92']) {
      expect(parseRgbReceiveAmount(input, 2)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('2 decimal places') });
    }
    expect(parseRgbReceiveAmount('0.5', 0)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('whole number') });
    expect(parseRgbReceiveAmount('1', NaN)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('precision') });
  });
});
