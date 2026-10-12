jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { beginPaymentAttempt, dismissPaymentAttempt, loadPaymentAttempt, savePaymentAttempt, updatePaymentAttempt, unresolvedAttempt } from './attempts';
import type { PaymentAttempt } from './attempts';

const attempt = (status: PaymentAttempt['status']): PaymentAttempt => ({ id: `a-${status}`, sourceId: 'bark', provider: 'Bark', total: '1,010 sats', recipient: '1,000 sats', createdAt: 1, status });

test('an unknown payment blocks the next one until the user dismisses it', async () => {
  await savePaymentAttempt(7, attempt('unknown'));
  await expect(beginPaymentAttempt(7, attempt('pending'))).rejects.toThrow('Check your previous payment');
  await dismissPaymentAttempt(7, (await loadPaymentAttempt(7))!);
  const dismissed = await loadPaymentAttempt(7);
  expect(dismissed).toMatchObject({ status: 'unknown', dismissedAt: expect.any(Number) });
  expect(unresolvedAttempt(dismissed)).toBe(false);
  await expect(beginPaymentAttempt(7, attempt('pending'))).resolves.toBeUndefined();
});

test('an unreadable record can be cleared so payments are possible again', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem('kaleidopay-attempt-v1-8', '{"broken":true}');
  await expect(beginPaymentAttempt(8, attempt('pending'))).rejects.toThrow('unreadable');
  await dismissPaymentAttempt(8, null);
  await expect(beginPaymentAttempt(8, attempt('pending'))).resolves.toBeUndefined();
});

test('receipt identity and quoted fees survive reopening without the original invoice', async () => {
  const receipt = { ...attempt('completed'), recipientName: 'Alice', feeDisplay: '10 sats', accountName: 'Spark' };
  await savePaymentAttempt(12, receipt);
  expect(await loadPaymentAttempt(12)).toEqual(receipt);
  await savePaymentAttempt(13, attempt('completed'));
  expect(await loadPaymentAttempt(13)).toEqual(attempt('completed'));
});

test('a delayed status result cannot overwrite a newer payment or undo dismissal', async () => {
  const old = attempt('unknown');
  await savePaymentAttempt(21, old);
  await dismissPaymentAttempt(21, old);
  expect(await updatePaymentAttempt(21, { ...old, status: 'pending' })).toBe(false);
  const next = { ...attempt('pending'), id: 'next' };
  await beginPaymentAttempt(21, next);
  expect(await updatePaymentAttempt(21, { ...old, status: 'completed' })).toBe(false);
  expect(await loadPaymentAttempt(21)).toEqual(next);
});
test('concurrent starts preserve one recovery record and final results never regress', async () => {
  const results = await Promise.allSettled([
    beginPaymentAttempt(22, { ...attempt('pending'), id: 'first' }),
    beginPaymentAttempt(22, { ...attempt('pending'), id: 'second' }),
  ]);
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  const saved = (await loadPaymentAttempt(22))!;
  expect(await updatePaymentAttempt(22, { ...saved, status: 'completed', reference: 'proof' })).toBe(true);
  expect(await updatePaymentAttempt(22, { ...saved, status: 'pending' })).toBe(false);
  expect(await loadPaymentAttempt(22)).toMatchObject({ id: 'first', status: 'completed', reference: 'proof' });
});
