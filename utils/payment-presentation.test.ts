import { paymentPollingRemaining, paymentPresentation } from './payment-presentation';
test('reopening an old attempt cannot restart automatic confirmation', () => {
  expect(paymentPollingRemaining(1000, 1000 + 26 * 60_000, 10 * 60_000)).toBe(0);
  expect(paymentPollingRemaining(1000, 1000 + 4 * 60_000, 10 * 60_000)).toBe(6 * 60_000);
});
test('unknown is not presented as confirmed or actively confirming', () => {
  expect(paymentPresentation({ status: 'unknown', sourceId: 'arkade' } as any).title).toBe('Payment outcome unknown');
});

test('RGB receipt explains the recipient handshake and preserves the current phase', () => {
  const pending = { status: 'pending', sourceId: 'rgb-asset', reference: 'rgb-tx' } as any;
  expect(paymentPresentation(pending)).toMatchObject({ title: 'RGB transfer in progress', detail: expect.stringContaining('recipient') });
  expect(paymentPresentation({ ...pending, detail: 'Waiting for Bitcoin confirmations.' }).detail).toBe('Waiting for Bitcoin confirmations.');
});
