import { rgbAmountUnits } from './rgb-amount';
test.each([['1,25', 2, 125], ['1.25', 6, 1250000], ['25', 0, 25], ['0.000001', 6, 1]])('parses %s exactly', (text, precision, expected) => {
  expect(rgbAmountUnits(text, precision)).toBe(expected);
});
test.each(['0', '-1', '1e3', '1.234', 'NaN', '1,2.3', '9007199254740992'])('rejects invalid or inexact amount %s', text => {
  expect(rgbAmountUnits(text, 2)).toBeUndefined();
});
