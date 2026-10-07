import { submitOrder, getRoutes } from './client';

const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const keyOf = (call: number) => fetchMock.mock.calls[call][1].headers['X-Idempotency-Key'];

describe('orchestra client', () => {
  beforeEach(() => fetchMock.mockReset());

  it('reuses one idempotency key for retries of a submit that carries a payment proof', async () => {
    fetchMock.mockResolvedValue(ok({ orderId: 'o', status: 'processing' }));
    await submitOrder({ quoteId: 'q1', sparkTxHash: 'tx1' });
    await submitOrder({ quoteId: 'q1', sparkTxHash: 'tx1' });
    expect(keyOf(0)).toBe('submit:q1:tx1');
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('gives each bare deposit poll its own key', async () => {
    fetchMock.mockResolvedValue(ok({ orderId: 'o', status: 'processing' }));
    await submitOrder({ quoteId: 'q1' });
    await submitOrder({ quoteId: 'q1' });
    expect(keyOf(0)).toMatch(/^submit:[0-9a-f]{32}$/);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('gives up on a stalled request', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: any) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    const pending = getRoutes();
    jest.advanceTimersByTime(15_000);
    await expect(pending).rejects.toThrow(/timed out/);
    jest.useRealTimers();
  });
});
