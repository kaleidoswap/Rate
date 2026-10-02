import { receiveAmountSats } from './receive-request';
test('BTC and sats requests encode the same payment amount', () => {
  expect(receiveAmountSats('0.00001', 'BTC')).toBe(1000);
  expect(receiveAmountSats('1,000', 'sats')).toBe(1000);
  expect(receiveAmountSats('0.00000001', 'BTC')).toBe(1);
  expect(receiveAmountSats('0.8', 'sats')).toBe(0);
});
test.each(['', '-1', 'Infinity', 'NaN', '9999999999999999999'])('does not encode an invalid amount: %s', input => {
  expect(receiveAmountSats(input, 'BTC')).toBe(0);
});
