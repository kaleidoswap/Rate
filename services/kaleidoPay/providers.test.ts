import AsyncStorage from '@react-native-async-storage/async-storage';
import { encodeOffer, encodePaymentCode } from '@universal-bolt12/universal-code';
import { registerKaleidoPayAccount, previewPayment, quotePaymentOffers, bestOffer, executePaymentOffer, checkPaymentStatus, PayAccount } from './index';
import { beginPaymentAttempt, loadPaymentAttempt, PaymentAttempt } from './attempts';
jest.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map();
  return { getItem: jest.fn(async k => data.get(k) ?? null), setItem: jest.fn(async (k, v) => { data.set(k, v); }), clear: jest.fn(async () => data.clear()) };
});
const code = encodePaymentCode({ offer: encodeOffer([{ type: 10n, value: new TextEncoder().encode('Coffee') }]), amountSat: 1000 }, 'signet');
const cleanups: Array<() => void> = [];
function account(id: string, fee = 10, overrides: Partial<PayAccount> = {}) {
  const a: PayAccount = { source: { id, rail: 'ln', network: 'signet' }, swaps: [], quote: jest.fn(async () => ({ recipientSat: 1000, totalSat: 1000 + fee, feeSat: fee, expiresAt: Math.floor(Date.now() / 1000) + 60 })), execute: jest.fn(async () => ({ status: 'completed' })), ...overrides };
  cleanups.push(registerKaleidoPayAccount(a)); return a;
}
const preview = () => previewPayment(code, 'signet', '', 'test');
afterEach(async () => { cleanups.splice(0).forEach(f => f()); await AsyncStorage.clear(); jest.useRealTimers(); });
test('compares real fees and keeps unavailable providers visible without paying during quotes', async () => {
  const a = account('a', 40), b = account('b', 10);
  account('offline', 1, { quote: jest.fn().mockRejectedValue(new Error('No liquidity')) });
  const offers = await quotePaymentOffers(preview());
  expect(offers).toHaveLength(3); expect(bestOffer(offers)?.route.sourceId).toBe('b');
  expect(offers[2].unavailable).toBe('No liquidity');
  expect(a.execute).not.toHaveBeenCalled(); expect(b.execute).not.toHaveBeenCalled();
});
test('does not compare unlike spend assets or accept an incorrect total', async () => {
  account('btc'); const token = { id: 'rgb:usdt', ticker: 'USDt', precision: 6 };
  account('token', 0, { spendAsset: token, quote: async () => ({ recipientSat: 1000, expiresAt: Math.floor(Date.now() / 1000) + 60, spend: { asset: token, amount: 1, fee: 0, total: 1 } }) });
  expect(bestOffer(await quotePaymentOffers(preview()))).toBeUndefined();
  account('bad', 0, { quote: async () => ({ recipientSat: 1000, totalSat: 1001, feeSat: 2, expiresAt: Math.floor(Date.now() / 1000) + 60 }) });
  expect((await quotePaymentOffers(preview())).find(o => o.route.sourceId === 'bad')?.unavailable).toMatch(/invalid/);
});
test('executes only the selected offer and never falls back after a timeout', async () => {
  const a = account('a', 10, { execute: jest.fn().mockRejectedValue(new Error('timeout')) }), b = account('b');
  const p = preview(); const [offer] = await quotePaymentOffers(p);
  expect(await executePaymentOffer(p, offer, 'timeout')).toEqual({ status: 'unknown' });
  expect(a.execute).toHaveBeenCalledTimes(1); expect(b.execute).not.toHaveBeenCalled();
  expect(await executePaymentOffer(p, offer, 'timeout')).toEqual({ status: 'unknown' });
  expect(a.execute).toHaveBeenCalledTimes(1);
});
test('deduplicates concurrent executions and blocks execution if storage fails', async () => {
  const a = account('a'); const p = preview(); const [offer] = await quotePaymentOffers(p);
  await Promise.all([executePaymentOffer(p, offer, 'one'), executePaymentOffer(p, offer, 'one')]);
  expect(a.execute).toHaveBeenCalledTimes(1);
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  await expect(executePaymentOffer(p, offer, 'two')).rejects.toThrow('disk');
  expect(a.execute).toHaveBeenCalledTimes(1);
});
test('rejects changed, expired or disconnected quotes', async () => {
  const a = account('a'); const p = preview(); let [offer] = await quotePaymentOffers(p);
  offer.quote!.totalSat!++;
  await expect(executePaymentOffer(p, offer, 'changed')).rejects.toThrow('changed');
  [offer] = await quotePaymentOffers(p);
  jest.useFakeTimers(); jest.setSystemTime(Date.now() + 61000);
  await expect(executePaymentOffer(p, offer, 'expired')).rejects.toThrow('expired');
  cleanups[0]();
  await expect(executePaymentOffer(p, offer, 'gone')).rejects.toThrow('disconnected');
  expect(a.execute).not.toHaveBeenCalled();
});
test('normalizes unknown SDK statuses instead of claiming success', async () => {
  account('a', 10, { execute: jest.fn(async () => ({ status: 'future' } as any)), status: jest.fn(async () => ({ status: 'future' } as any)) });
  const p = preview(); const [offer] = await quotePaymentOffers(p);
  expect((await executePaymentOffer(p, offer, 'future')).status).toBe('unknown');
  expect((await checkPaymentStatus('a', 'future')).status).toBe('unknown');
});
test('pending recovery record survives reopening and cannot be overwritten', async () => {
  const attempt: PaymentAttempt = { id: 'one', sourceId: 'a', provider: 'A', total: '1001 sats', recipient: '1000 sats', createdAt: Date.now(), status: 'pending' };
  await beginPaymentAttempt(1, attempt);
  await expect(beginPaymentAttempt(1, { ...attempt, id: 'two' })).rejects.toThrow('previous');
  expect(await loadPaymentAttempt(1)).toEqual(attempt);
  await AsyncStorage.setItem('kaleidopay-attempt-v1-2', '{"status":"completed"}');
  await expect(loadPaymentAttempt(2)).rejects.toThrow('unreadable');
});
test('times out quotes and rejects late disconnects', async () => {
  jest.useFakeTimers(); account('slow', 1, { quote: () => new Promise(() => {}) });
  const request = quotePaymentOffers(preview()); await jest.advanceTimersByTimeAsync(15000);
  expect((await request)[0].unavailable).toMatch(/did not respond/);
});
