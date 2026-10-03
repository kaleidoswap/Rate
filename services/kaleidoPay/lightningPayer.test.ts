import { lightningPayerFrom } from './lightningPayer';

const sender = (script: Record<string, string[]>) => {
  const calls: string[] = [];
  return {
    calls,
    async sendPayment({ invoice }: { invoice: string }) { calls.push(invoice); return { paymentHash: invoice, status: 'pending' }; },
    async getPaymentStatus(hash: string) { return { status: script[hash].shift() ?? 'pending' }; },
  };
};

test('sends every invoice before waiting, and returns once all settle', async () => {
  const s = sender({ main: ['pending', 'confirmed'], prepay: ['confirmed'] });
  const sent = jest.spyOn(s, 'sendPayment');
  const done = lightningPayerFrom(s, { pollMs: 1 }).payInvoices(['main', 'prepay']);
  await Promise.resolve();
  expect(sent).toHaveBeenCalledTimes(2); // both out before any settles
  await expect(done).resolves.toBeUndefined();
});

test('throws as soon as one payment fails', async () => {
  const s = sender({ main: ['pending', 'pending'], prepay: ['failed'] });
  await expect(lightningPayerFrom(s, { pollMs: 1 }).payInvoices(['main', 'prepay'])).rejects.toThrow('failed');
});

test('gives up after the timeout', async () => {
  const s = sender({ main: [] });
  await expect(lightningPayerFrom(s, { pollMs: 1, timeoutMs: 5 }).payInvoices(['main'])).rejects.toThrow('in time');
});
