// services/swapTools.test.ts
//
// Binding tests for the fund-moving, venue-aware swap tools. These run against
// a MOCKED maker/rln/flashnet SDK (no node, no network) and verify the parts
// that move money or could go wrong silently:
//   - venue routing (KaleidoSwap maker vs Flashnet) by the pair's venue
//   - unit translation per venue (maker BTC→msat; flashnet BTC→sats; asset→raw)
//   - quote caching + place_order replaying each venue's tested sequence
//   - the maker swapstring anti-tamper check aborts before whitelisting
//
// Pair *building* (normalizeMakerPairs / buildFlashnetPairs) is mocked to return
// SwapPair fixtures so the test exercises MY routing + conversion against the
// real findPair/getAssetId/getQuoteLayers/validateSwapString helpers. On-device
// end-to-end (a funded node executing a real swap) still needs a device test.

import { buildSwapToolSource } from './swapTools';
import { protocolManager, kaleidoClientManager, flashnetClientManager } from './protocols';
import { normalizeMakerPairs, buildFlashnetPairs } from '../utils/swap-model';

jest.mock('./protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn() },
  kaleidoClientManager: { isInitialized: jest.fn(() => true), getClient: jest.fn() },
  flashnetClientManager: { isInitialized: jest.fn(() => false), getClient: jest.fn(), getPoolId: jest.fn(() => 'pool1') },
}));
jest.mock('../utils/swap-model', () => {
  const actual = jest.requireActual('../utils/swap-model');
  return { ...actual, normalizeMakerPairs: jest.fn(() => []), buildFlashnetPairs: jest.fn(() => []) };
});

const mManager = protocolManager as jest.Mocked<typeof protocolManager>;
const mKaleido = kaleidoClientManager as jest.Mocked<typeof kaleidoClientManager>;
const mFlash = flashnetClientManager as jest.Mocked<typeof flashnetClientManager>;
const mNormalize = normalizeMakerPairs as jest.Mock;
const mBuildFlash = buildFlashnetPairs as jest.Mock;

const MAKER_PAIR = {
  id: 'btc-usdt',
  base: { ticker: 'BTC', name: 'Bitcoin', precision: 8, protocol_ids: { RGB: 'btc' } },
  quote: { ticker: 'USDT', name: 'Tether', precision: 6, protocol_ids: { RGB: 'rgb:usdt' } },
  routes: [{ from_layer: 'BTC_LN', to_layer: 'RGB_LN' }],
  is_active: true, venue: 'kaleidoswap' as const,
};
const FLASH_PAIR = {
  id: 'flashnet-btc-usdb',
  base: { ticker: 'BTC', name: 'Bitcoin', precision: 8, protocol_ids: { SPARK: 'btc-spark' } },
  quote: { ticker: 'USDB', name: 'USD Brale', precision: 6, protocol_ids: { SPARK: 'usdb-spark' } },
  routes: [], is_active: true, venue: 'flashnet' as const, poolId: 'pool1',
};

describe('swap tools — KaleidoSwap maker venue', () => {
  let maker: any;
  let rln: any;
  let source: ReturnType<typeof buildSwapToolSource>;

  beforeEach(() => {
    jest.clearAllMocks();
    mNormalize.mockReturnValue([MAKER_PAIR]);
    mBuildFlash.mockReturnValue([]);
    maker = {
      listPairs: jest.fn(async () => ({})),
      getQuote: jest.fn(async () => ({
        rfq_id: 'rfq1',
        from_asset: { asset_id: 'btc', amount: 100_000_000 }, // 100k sats → 100M msat
        to_asset: { asset_id: 'rgb:usdt', amount: 73_000_000 }, // 73 USDT (p6)
        price: 73000, fee: { final_fee: 12 }, expires_at: 1234,
      })),
      initSwap: jest.fn(async () => ({ swapstring: '100000000/btc/73000000/rgb:usdt/x/hash1', payment_hash: 'hash1' })),
      executeSwap: jest.fn(async () => ({})),
      getSwapNodeInfo: jest.fn(async () => ({ pubkey: '02maker' })),
    };
    rln = { whitelistSwap: jest.fn(async () => undefined), getTakerPubkey: jest.fn(async () => '02taker') };
    mManager.getAdapterIfAvailable.mockImplementation((p: any) =>
      p === 'RGB' ? ({ isConnected: () => true, getSwapStatus: jest.fn(async () => ({ status: 'completed' })) } as any) : null);
    mKaleido.isInitialized.mockReturnValue(true);
    mKaleido.getClient.mockReturnValue({ maker, rln } as any);
    mFlash.isInitialized.mockReturnValue(false);
    source = buildSwapToolSource();
  });

  it('binds market + orders, not the atomic group; place_order is confirm-gated', async () => {
    const defs = await Promise.resolve(source.listTools());
    const names = defs.map((d) => d.name);
    expect(names).toContain('kaleidoswap_place_order');
    expect(names).not.toContain('kaleidoswap_atomic_init');
    expect(defs.find((d) => d.name === 'kaleidoswap_place_order')?.requiresConfirmation).toBe(true);
    expect(defs.find((d) => d.name === 'kaleidoswap_get_quote')?.requiresConfirmation).toBeFalsy();
  });

  it('get_quote converts BTC sats→msat and returns the receive in display units', async () => {
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    expect(maker.getQuote).toHaveBeenCalledWith({
      from_asset: { asset_id: 'btc', layer: 'BTC_LN', amount: 100_000_000 },
      to_asset: { asset_id: 'rgb:usdt', layer: 'RGB_LN' },
    });
    expect(q.quote_id).toBe('rfq1');
    expect(q.venue).toBe('kaleidoswap');
    expect(q.receive_amount).toBe(73);
  });

  it('place_order replays init→validate→whitelist→execute with the quoted ints', async () => {
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    const res: any = await source.execute('kaleidoswap_place_order', { quote_id: 'rfq1' });
    expect(maker.initSwap).toHaveBeenCalledWith({
      rfq_id: 'rfq1', from_asset: 'btc', from_amount: 100_000_000, to_asset: 'rgb:usdt', to_amount: 73_000_000,
    });
    expect(rln.whitelistSwap).toHaveBeenCalledWith('100000000/btc/73000000/rgb:usdt/x/hash1');
    expect(maker.executeSwap).toHaveBeenCalledWith({ swapstring: '100000000/btc/73000000/rgb:usdt/x/hash1', taker_pubkey: '02taker', payment_hash: 'hash1' });
    expect(res.status).toBe('executing');
  });

  it('aborts before whitelisting if the maker swapstring does not match the quote', async () => {
    maker.initSwap.mockResolvedValueOnce({ swapstring: '999/btc/73000000/rgb:usdt/x/hash1', payment_hash: 'hash1' });
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    await expect(source.execute('kaleidoswap_place_order', { quote_id: 'rfq1' })).rejects.toThrow(/verification failed/i);
    expect(rln.whitelistSwap).not.toHaveBeenCalled();
    expect(maker.executeSwap).not.toHaveBeenCalled();
  });

  it('refuses to place an order without a fresh quote', async () => {
    await expect(source.execute('kaleidoswap_place_order', { quote_id: 'nope' })).rejects.toThrow(/no longer available|re-quote/i);
    expect(maker.initSwap).not.toHaveBeenCalled();
  });
});

describe('swap tools — Flashnet venue', () => {
  let flash: any;
  let source: ReturnType<typeof buildSwapToolSource>;

  beforeEach(() => {
    jest.clearAllMocks();
    mNormalize.mockReturnValue([]);
    mBuildFlash.mockReturnValue([FLASH_PAIR]);
    flash = {
      listPools: jest.fn(async () => ({ pools: [] })),
      encodeTokenAddress: jest.fn((a: string) => `bech32:${a}`),
      simulateSwap: jest.fn(async () => ({ amountOut: 36_000_000, feePaidAssetIn: 50, executionPrice: 720 })),
      executeSwap: jest.fn(async () => ({ outboundTransferId: 'tx1' })),
    };
    // Flashnet connected, RGB not.
    mKaleido.isInitialized.mockReturnValue(false);
    mFlash.isInitialized.mockReturnValue(true);
    mFlash.getClient.mockReturnValue(flash as any);
    mFlash.getPoolId.mockReturnValue('pool1');
    mManager.getAdapterIfAvailable.mockImplementation((p: any) =>
      p === 'SPARK' ? ({ isConnected: () => true, listAssets: jest.fn(async () => []) } as any) : null);
    source = buildSwapToolSource();
  });

  it('get_quote routes to Flashnet (BTC→sats) and simulates the pool swap', async () => {
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDB', amount: 50_000 });
    expect(flash.simulateSwap).toHaveBeenCalledWith(expect.objectContaining({
      poolId: 'pool1', assetInAddress: 'btc-spark', assetOutAddress: 'usdb-spark', amountIn: '50000',
    }));
    expect(q.venue).toBe('flashnet');
    expect(q.quote_id).toMatch(/^flashnet-/);
    expect(q.receive_amount).toBe(36); // 36_000_000 / 10^6
  });

  it('place_order executes the pool swap with a floored minAmountOut', async () => {
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDB', amount: 50_000 });
    const res: any = await source.execute('kaleidoswap_place_order', { quote_id: q.quote_id });
    expect(flash.executeSwap).toHaveBeenCalledWith(expect.objectContaining({
      poolId: 'pool1', assetInAddress: 'btc-spark', assetOutAddress: 'usdb-spark',
      amountIn: '50000', minAmountOut: String(Math.floor(36_000_000 * 0.95)),
    }));
    expect(res.status).toBe('completed');
    expect(res.txid).toBe('tx1');
  });

  it('get_order_status reports flashnet orders as completed (instant settle)', async () => {
    const s: any = await source.execute('kaleidoswap_get_order_status', { order_id: 'flashnet-123' });
    expect(s.status).toBe('completed');
  });
});

describe('swap tools — no venue connected', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mKaleido.isInitialized.mockReturnValue(false);
    mFlash.isInitialized.mockReturnValue(false);
    mManager.getAdapterIfAvailable.mockReturnValue(null as any);
  });

  it('refuses to quote when neither RGB nor Spark is connected', async () => {
    const source = buildSwapToolSource();
    await expect(source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 1000 }))
      .rejects.toThrow(/connect your rgb lightning or spark/i);
  });
});
