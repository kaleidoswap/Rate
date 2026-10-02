import { paymentReceiptStatus } from './payment-receipt';
test('does not present an unknown or empty provider response as success', () => {
  expect(paymentReceiptStatus(undefined)).toBe('unknown');
  expect(paymentReceiptStatus({ status: 'unknown', paymentHash: 'hash' })).toBe('unknown');
  expect(paymentReceiptStatus({ status: 'processing' })).toBe('pending');
});
test('distinguishes a broadcast transaction from a settled payment', () => {
  expect(paymentReceiptStatus({ txid: 'tx' }, true)).toBe('pending');
  expect(paymentReceiptStatus({ status: 'completed' })).toBe('confirmed');
  expect(paymentReceiptStatus({ preimage: 'proof' })).toBe('confirmed');
  expect(() => paymentReceiptStatus({ status: 'failed' })).toThrow('failed payment');
});
