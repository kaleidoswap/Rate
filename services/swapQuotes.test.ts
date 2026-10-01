import { fetchSwapOffers, bestSwapOffer, SwapOffer } from './swapQuotes';
import { flashnetClientManager, kaleidoClientManager } from './protocols';
import { SwapPair } from '../utils/swap-model';
jest.mock('./protocols', () => ({
  flashnetClientManager: { getPoolId: () => 'pool', getClient: jest.fn() },
  kaleidoClientManager: { isInitialized: () => true, getClient: jest.fn() },
}));
const pair = (id: string): SwapPair => ({ id, poolId: id, venue: 'flashnet', base: { ticker: 'BTC', name: 'Bitcoin', precision: 8, protocol_ids: { SPARK: 'btc' } }, quote: { ticker: 'TOK', name: 'Token', precision: 0, protocol_ids: { SPARK: 'token' } }, routes: [] });
afterEach(() => jest.useRealTimers());
test('compares live pools with integer token precision and no invented fallback', async () => {
  const simulateSwap = jest.fn(async ({ poolId }: any) => { if (poolId === 'offline') throw new Error('Offline'); return { amountOut: poolId === 'best' ? '20' : '18', feePaidAssetIn: '2' }; });
  (flashnetClientManager.getClient as jest.Mock).mockReturnValue({ simulateSwap });
  const offers = await fetchSwapOffers([pair('one'), pair('best'), pair('offline')], 'BTC', 'TOK', 1000, 'sats');
  expect(offers[0].quote?.to_amount).toBe(18); expect(bestSwapOffer(offers)?.pair.poolId).toBe('best');
  expect(offers[2].quote).toBeUndefined(); expect(offers[2].unavailable).toBe('Offline');
  expect(simulateSwap).toHaveBeenCalledWith(expect.objectContaining({ amountIn: '1000' }));
});
test('rejects missing/zero output, fractional base units and nonfinite fee', async () => {
  const simulateSwap = jest.fn().mockResolvedValue({ amountOut: '0', feePaidAssetIn: '0' });
  (flashnetClientManager.getClient as jest.Mock).mockReturnValue({ simulateSwap });
  expect((await fetchSwapOffers([pair('one')], 'BTC', 'TOK', 1000, 'sats'))[0].unavailable).toMatch(/empty/);
  expect((await fetchSwapOffers([pair('one')], 'BTC', 'TOK', 0.1, 'sats'))[0].unavailable).toMatch(/amount/);
  simulateSwap.mockResolvedValue({ amountOut: '20' });
  expect((await fetchSwapOffers([pair('one')], 'BTC', 'TOK', 1000, 'sats'))[0].unavailable).toMatch(/fee/);
});
test('does not rank different tokens sharing a ticker or expired quotes', async () => {
  (flashnetClientManager.getClient as jest.Mock).mockReturnValue({ simulateSwap: async () => ({ amountOut: '20', feePaidAssetIn: '2' }) });
  const different = pair('two'); different.quote.protocol_ids = { SPARK: 'different-token' };
  const offers = await fetchSwapOffers([pair('one'), different], 'BTC', 'TOK', 1000, 'sats');
  expect(bestSwapOffer(offers)).toBeUndefined();
  offers[1].quote!.expiry_timestamp = 0;
  expect(bestSwapOffer(offers)?.pair.poolId).toBe('one');
});
test('binds provider and route snapshot instead of mutable pair discovery data', async () => {
  (flashnetClientManager.getClient as jest.Mock).mockReturnValue({ simulateSwap: async () => ({ amountOut: '20', feePaidAssetIn: '2' }) });
  const original = pair('one'); const [offer] = await fetchSwapOffers([original], 'BTC', 'TOK', 1000, 'sats');
  original.poolId = 'changed'; original.quote.precision = 6;
  expect(offer.pair.poolId).toBe('one'); expect(offer.pair.quote.precision).toBe(0);
});
test('bounds slow provider waits', async () => {
  jest.useFakeTimers(); (flashnetClientManager.getClient as jest.Mock).mockReturnValue({ simulateSwap: () => new Promise(() => {}) });
  const request = fetchSwapOffers([pair('slow')], 'BTC', 'TOK', 1000, 'sats');
  await jest.advanceTimersByTimeAsync(15000);
  expect((await request)[0].unavailable).toMatch(/did not respond/);
});

test('rejects a provider replacement after a quote was reviewed', async () => {
  const { assertSwapQuoteProvider } = require('./swapQuotes');
  const client = { simulateSwap: async () => ({ amountOut: '20', feePaidAssetIn: '2' }) };
  (flashnetClientManager.getClient as jest.Mock).mockReturnValue(client);
  const [offer] = await fetchSwapOffers([pair('one')], 'BTC', 'TOK', 1000, 'sats');
  expect(() => assertSwapQuoteProvider(offer.quote!)).not.toThrow();
  (flashnetClientManager.getClient as jest.Mock).mockReturnValue({ ...client });
  expect(() => assertSwapQuoteProvider(offer.quote!)).toThrow('connection changed');
});
