jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadPaymentAttempt, savePaymentAttempt, type PaymentAttempt } from './attempts';
import { cancelPendingPayment, inFlightMessage, paymentRailKind, type CancelDeps } from './cancelPayment';
import { contactEvents, recordContactEvent } from '../contactHistory';

const attempt = (over: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  id: 'a1', sourceId: 'spark-ln', provider: 'Spark', total: '1,010 sats', recipient: '1,000 sats', createdAt: 5, status: 'unknown',
  destinationRail: 'ln:mainnet', ...over,
});

const deps = (over: Partial<CancelDeps> = {}): CancelDeps => ({
  prepare: jest.fn(async () => {}),
  handedOver: jest.fn(async () => true),
  status: jest.fn(async () => ({ status: 'unknown' as const })),
  cancel: jest.fn(async () => ({ status: 'unknown' as const })),
  rgb: () => null,
  ...over,
});

beforeEach(() => AsyncStorage.clear());

test('a payment that never left this phone is marked failed without asking the provider', async () => {
  await savePaymentAttempt(1, attempt());
  const d = deps({ handedOver: jest.fn(async () => false) });
  const result = await cancelPendingPayment(1, 'a1', d);
  expect(result.outcome).toBe('not-sent');
  expect(result.message).toMatch(/never left your wallet/);
  expect(d.status).not.toHaveBeenCalled();
  expect((await loadPaymentAttempt(1, 'a1'))?.status).toBe('failed');
});

test('re-checks first: a payment that went through shows as completed and is not cancelled', async () => {
  await savePaymentAttempt(1, attempt());
  await recordContactEvent(1, { id: 'a1', attemptId: 'a1', contactKey: 'bob', contactName: 'Bob', direction: 'sent', amount: '1,000 sats', status: 'unknown', createdAt: 5 });
  const d = deps({ status: jest.fn(async () => ({ status: 'completed' as const, reference: 'hash' })) });
  const result = await cancelPendingPayment(1, 'a1', d);
  expect(result.outcome).toBe('completed');
  expect(d.cancel).not.toHaveBeenCalled();
  expect(await loadPaymentAttempt(1, 'a1')).toMatchObject({ status: 'completed', reference: 'hash' });
  expect((await contactEvents(1, ['bob']))[0].status).toBe('completed');
});

test('a payment the provider reports failed is marked failed, never "returned"', async () => {
  await savePaymentAttempt(1, attempt());
  const result = await cancelPendingPayment(1, 'a1', deps({ status: jest.fn(async () => ({ status: 'failed' as const })) }));
  expect(result.outcome).toBe('not-sent');
  expect(result.message).not.toMatch(/return|refund/i);
  expect((await loadPaymentAttempt(1, 'a1'))?.status).toBe('failed');
});

test('an account that can cancel is asked, and only its confirmation marks the payment failed', async () => {
  await savePaymentAttempt(1, attempt({ sourceId: 'arkade', destinationRail: 'ark:mainnet', provider: 'Arkade' }));
  const d = deps({ status: jest.fn(async () => ({ status: 'pending' as const })), cancel: jest.fn(async () => ({ status: 'failed' as const })) });
  const result = await cancelPendingPayment(1, 'a1', d);
  expect(d.cancel).toHaveBeenCalledWith('arkade', 'a1');
  expect(result.outcome).toBe('cancelled');
  expect(await loadPaymentAttempt(1, 'a1')).toMatchObject({ status: 'failed', detail: 'Cancelled at your request.' });
});

test('a Lightning payment in flight is not cancelled and says why; the record is unchanged', async () => {
  await savePaymentAttempt(1, attempt({ status: 'pending' }));
  const result = await cancelPendingPayment(1, 'a1', deps({ status: jest.fn(async () => ({ status: 'pending' as const })) }));
  expect(result.outcome).toBe('in-flight');
  expect(result.message).toMatch(/can’t be called back/);
  expect((await loadPaymentAttempt(1, 'a1'))?.status).toBe('pending');
});

test('an unreachable provider is reported as such, nothing cancelled', async () => {
  await savePaymentAttempt(1, attempt({ sourceId: 'bark-onchain', destinationRail: 'btc:mainnet', provider: 'Bark' }));
  const result = await cancelPendingPayment(1, 'a1', deps());
  expect(result.outcome).toBe('in-flight');
  expect(result.message).toMatch(/^Bark couldn’t confirm where this payment is, so nothing was cancelled\./);
  expect(result.message).toMatch(/can’t replace or cancel it/);
});

test('an RGB send the recipient has not accepted is failed through the RGB account', async () => {
  await savePaymentAttempt(1, attempt({ sourceId: 'rgb-asset', destinationRail: 'rgb:mainnet', provider: 'RGB wallet', status: 'pending', reference: 'tx1' }));
  const fail = jest.fn(async () => true);
  const result = await cancelPendingPayment(1, 'a1', deps({
    status: jest.fn(async () => ({ status: 'pending' as const, reference: 'tx1' })),
    rgb: () => ({ findOutgoing: async (txid: string) => txid === 'tx1' ? { status: 'waiting-counterparty' as const, batchTransferIdx: 3 } : undefined, fail }),
  }));
  expect(fail).toHaveBeenCalledWith(3);
  expect(result.outcome).toBe('cancelled');
  expect((await loadPaymentAttempt(1, 'a1'))?.status).toBe('failed');
});

test('an RGB send already accepted can’t be cancelled', async () => {
  await savePaymentAttempt(1, attempt({ sourceId: 'rgb-asset', destinationRail: 'rgb:mainnet', status: 'pending', reference: 'tx1' }));
  const fail = jest.fn(async () => true);
  const result = await cancelPendingPayment(1, 'a1', deps({
    status: jest.fn(async () => ({ status: 'pending' as const })),
    rgb: () => ({ findOutgoing: async () => ({ status: 'waiting-confirmations' as const, batchTransferIdx: 3 }), fail }),
  }));
  expect(fail).not.toHaveBeenCalled();
  expect(result.outcome).toBe('in-flight');
});

test('a settled or removed payment has nothing to cancel', async () => {
  await savePaymentAttempt(1, attempt({ status: 'completed' }));
  expect((await cancelPendingPayment(1, 'a1', deps())).outcome).toBe('completed');
  await savePaymentAttempt(2, attempt({ dismissedAt: 9 }));
  expect((await cancelPendingPayment(2, 'a1', deps())).outcome).toBe('gone');
  expect((await cancelPendingPayment(3, 'missing', deps())).outcome).toBe('gone');
});

test('rails are classified for their cancel rules', () => {
  expect(paymentRailKind({ sourceId: 'spark-ln', destinationRail: 'ln:mainnet' })).toBe('lightning');
  expect(paymentRailKind({ sourceId: 'rgb-btc' })).toBe('onchain');
  expect(paymentRailKind({ sourceId: 'rgb-asset' })).toBe('rgb-transfer');
  expect(paymentRailKind({ sourceId: 'arkade', destinationRail: 'ark:mainnet' })).toBe('offchain');
  expect(inFlightMessage({ sourceId: 'arkade', destinationRail: 'ark:mainnet', provider: 'Arkade' })).toMatch(/^Arkade doesn’t offer a way to cancel/);
});
