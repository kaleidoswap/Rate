import { fetchSwapOffers, bestSwapOffer, SwapOffer, loadChannelLiquidity, quoteChannelShortfall } from './swapQuotes';
import { flashnetClientManager, kaleidoClientManager, protocolManager } from './protocols';
import { SwapPair } from '../utils/swap-model';
import type { SwapQuote } from '../store/slices/swapSlice';
jest.mock('./protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn() },
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

describe('channel liquidity', () => {
  const btcChannel = (outSat: number, inSat: number) => ({
    channel_id: 'c1', ready: true, is_usable: true,
    outbound_balance_msat: outSat * 1000, next_outbound_htlc_limit_msat: outSat * 1000, inbound_balance_msat: inSat * 1000,
  });
  const usdtChannel = (local: number, remote: number) => ({
    channel_id: 'c2', ready: true, is_usable: true, asset_id: 'rgb:usdt', asset_local_amount: local, asset_remote_amount: remote,
    outbound_balance_msat: 10_000_000, next_outbound_htlc_limit_msat: 10_000_000, inbound_balance_msat: 10_000_000,
  });
  const makerQuote = (over: Partial<SwapQuote> = {}): SwapQuote => ({
    rfq_id: 'rfq1', from_asset: 'BTC', to_asset: 'USDT', from_amount: 100_000, to_amount: 73, fee_amount: 0, exchange_rate: 0,
    expiry_timestamp: Date.now() + 60_000, maker_pubkey: '', venue: 'kaleidoswap',
    from_asset_id: 'btc', to_asset_id: 'rgb:usdt', from_amount_raw: 100_000_000, to_amount_raw: 73_000_000, ...over,
  });
  const adapter = (over: any = {}) => ({ isConnected: () => true, listChannels: jest.fn(async () => [btcChannel(200_000, 0), usdtChannel(0, 100_000_000)]), getNodeInfo: jest.fn(async () => ({ rgb_htlc_min_msat: 1_000_000 })), ...over });
  const useAdapter = (a: any) => (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation((p: string) => (p === 'RGB_LN' ? a : null));

  test('loads channels and the node-reported HTLC minimum', async () => {
    useAdapter(adapter());
    const liquidity = await loadChannelLiquidity();
    expect(liquidity.channels).toHaveLength(2);
    expect(liquidity.htlcMinMsat).toBe(1_000_000);
  });
  test('channels are unknown without a node or when they fail to load', async () => {
    useAdapter(null);
    expect(await loadChannelLiquidity()).toEqual({ htlcMinMsat: 3_000_000 });
    useAdapter(adapter({ isConnected: () => false }));
    expect((await loadChannelLiquidity()).channels).toBeUndefined();
    useAdapter(adapter({ listChannels: jest.fn(async () => { throw new Error('offline'); }), getNodeInfo: jest.fn(async () => { throw new Error('offline'); }) }));
    expect(await loadChannelLiquidity()).toEqual({ channels: undefined, htlcMinMsat: 3_000_000 });
  });
  test('flags a maker quote the channels cannot carry', () => {
    const liquidity = { channels: [btcChannel(101_000, 0), usdtChannel(0, 100_000_000)], htlcMinMsat: 3_000_000 };
    expect(quoteChannelShortfall(makerQuote(), liquidity)).toMatch(/can send at most 101,000 sats/);
    expect(quoteChannelShortfall(makerQuote({ from_amount: 90_000, from_amount_raw: 90_000_000 }), liquidity)).toBeNull();
  });
  test('names the asset leg with the given label', () => {
    const liquidity = { channels: [btcChannel(200_000, 0), usdtChannel(0, 1_000_000)], htlcMinMsat: 3_000_000 };
    expect(quoteChannelShortfall(makerQuote(), liquidity, (a, t) => `${a.toFixed(2)} ${t}`)).toMatch(/receive 73.00 USDT/);
  });
  test('never blocks Flashnet quotes or unknown channels', () => {
    const empty = { channels: [], htlcMinMsat: 3_000_000 };
    expect(quoteChannelShortfall(makerQuote(), empty)).toMatch(/no channels/);
    expect(quoteChannelShortfall(makerQuote({ venue: 'flashnet' }), empty)).toBeNull();
    expect(quoteChannelShortfall(makerQuote(), { htlcMinMsat: 3_000_000 })).toBeNull();
    expect(quoteChannelShortfall(makerQuote({ to_amount_raw: undefined }), empty)).toBeNull();
  });
});
