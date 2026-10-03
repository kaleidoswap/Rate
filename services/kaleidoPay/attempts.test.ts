jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { beginPaymentAttempt, dismissPaymentAttempt, loadPaymentAttempt, savePaymentAttempt, unresolvedAttempt } from './attempts';
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
