import { describeIncoming, incomingPayments, mergeBalances } from './paymentWatch';

test('only accounts whose balance went up count as incoming', () => {
  expect(incomingPayments({ SPARK: 1000, ARKADE: 5000 }, { SPARK: 22000, ARKADE: 4000 })).toEqual([{ account: 'SPARK', sats: 21000 }]);
});

test('a first reading, or an account seen for the first time, is a baseline', () => {
  expect(incomingPayments(null, { SPARK: 5000 })).toEqual([]);
  expect(incomingPayments({ SPARK: 0 }, { SPARK: 0, ARKADE: 9000 })).toEqual([]);
});

test('the baseline keeps accounts not read this time', () => {
  expect(mergeBalances({ SPARK: 1, ARKADE: 2 }, { SPARK: 5 })).toEqual({ SPARK: 5, ARKADE: 2 });
});

test('the message names amounts and accounts', () => {
  expect(describeIncoming([{ account: 'SPARK', sats: 21000 }])).toBe('You received 21,000 sats in Spark');
  expect(describeIncoming([{ account: 'SPARK', sats: 1 }, { account: 'ARKADE', sats: 5000 }])).toBe('You received 1 sat in Spark and 5,000 sats in Arkade');
});
