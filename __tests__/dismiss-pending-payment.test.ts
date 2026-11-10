jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../services/kaleidoPay/recovery', () => ({ kaleidoPayAttempts: { list: jest.fn(async () => []) } }));

import { beginPaymentAttempt, loadPaymentAttempts, savePaymentAttempt, type PaymentAttempt } from '../services/kaleidoPay/attempts';
import { dismissPendingPayment, loadPendingPaymentActivity, paymentAttemptIdOf } from '../services/kaleidoPay/activity';
import { contactEvents, recordContactEvent, removeContactEvent } from '../services/contactHistory';

// An RGB node payment from an earlier version: no answer, no payment hash.
const stuck = (id: string, status: PaymentAttempt['status']): PaymentAttempt => ({
  id, sourceId: 'rgb-ln', provider: 'RGB node', total: '2,000 sats', recipient: '2,000 sats', createdAt: 5, status,
});

test('a payment needing a check, or stuck pending, is removed from Activity and the contact history', async () => {
  await savePaymentAttempt(3, stuck('old', 'unknown'));
  await beginPaymentAttempt(3, stuck('new', 'pending'));
  await recordContactEvent(3, { id: 'old', attemptId: 'old', contactKey: 'bob@example.com', contactName: 'Bob', direction: 'sent', amount: '2,000 sats', status: 'unknown', createdAt: 5 });
  const rows = await loadPendingPaymentActivity(3);
  expect(rows.map((r: any) => [r.id, r.status])).toEqual([['payment-attempt-old', 'unknown'], ['payment-attempt-new', 'pending']]);
  expect(paymentAttemptIdOf(rows[0])).toBe('old');

  // An archived (older) record is removed as well as the latest one.
  expect(await dismissPendingPayment(3, 'old')).toBe(true);
  expect(await contactEvents(3, ['bob@example.com'])).toEqual([]);
  expect(await dismissPendingPayment(3, 'new')).toBe(true);
  expect(await loadPendingPaymentActivity(3)).toEqual([]);
  // Kept, marked dismissed: never deleted.
  expect((await loadPaymentAttempts(3)).every(a => a.dismissedAt)).toBe(true);
  // Nothing left to remove.
  expect(await dismissPendingPayment(3, 'old')).toBe(false);
  expect(await dismissPendingPayment(3, 'missing')).toBe(false);
});

test('a settled payment is never dismissed', async () => {
  await savePaymentAttempt(4, stuck('done', 'completed'));
  expect(await dismissPendingPayment(4, 'done')).toBe(false);
  expect((await loadPaymentAttempts(4))[0].dismissedAt).toBeUndefined();
});

test('removing a contact event leaves the others', async () => {
  const event = { contactKey: 'carol@example.com', contactName: 'Carol', direction: 'sent' as const, amount: '1 sats', status: 'unknown' as const };
  await recordContactEvent(5, { ...event, id: 'a', attemptId: 'a', createdAt: 1 });
  await recordContactEvent(5, { ...event, id: 'b', attemptId: 'b', createdAt: 2 });
  await removeContactEvent(5, 'a');
  expect((await contactEvents(5, ['carol@example.com'])).map(e => e.id)).toEqual(['b']);
});

test('only payment-attempt rows have an attempt id', () => {
  expect(paymentAttemptIdOf({ id: 'payment-hash', kind: undefined })).toBeUndefined();
  expect(paymentAttemptIdOf({ id: 'payment-attempt-x', kind: 'payment-attempt' })).toBe('x');
});
