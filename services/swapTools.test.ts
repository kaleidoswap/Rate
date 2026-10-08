// services/swapTools.test.ts
//
// Binding tests for the fund-moving, venue-aware swap tools. These run against
// a MOCKED maker/rln/flashnet SDK (no node, no network) and verify the parts
// that move money or could go wrong silently:
//   - venue routing (KaleidoSwap maker vs Flashnet) by the pair's venue
//   - unit translation per venue (maker BTC→msat; flashnet BTC→sats; asset→raw)
//   - quote caching + execute_swap replaying each venue's tested sequence
//   - the maker swapstring anti-tamper check aborts before whitelisting
//
// Pair *building* (normalizeMakerPairs / buildFlashnetPairs) is mocked to return
// SwapPair fixtures so the test exercises MY routing + conversion against the
// real findPair/getAssetId/getQuoteLayers/validateSwapString helpers. On-device
// end-to-end (a funded node executing a real swap) still needs a device test.

import { buildSwapToolSource, describeSwapQuote, refreshSwapQuoteForConfirm, quoteNeedsRefresh, priceMove } from './swapTools';

const inAMinute = () => Math.floor(Date.now() / 1000) + 60;
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
        price: 73000, fee: { final_fee: 12 }, expires_at: inAMinute(),
      })),
      initSwap: jest.fn(async () => ({ swapstring: '100000000/btc/73000000/rgb:usdt/x/hash1', payment_hash: 'hash1' })),
      executeSwap: jest.fn(async () => ({})),
      getSwapNodeInfo: jest.fn(async () => ({ pubkey: '02maker' })),
    };
    rln = { whitelistSwap: jest.fn(async () => undefined), getTakerPubkey: jest.fn(async () => '02taker') };
    mManager.getAdapterIfAvailable.mockImplementation((p: any) =>
      p === 'RGB_LN' ? ({ isConnected: () => true, getSwapStatus: jest.fn(async () => ({ status: 'completed' })) } as any) : null);
    mKaleido.isInitialized.mockReturnValue(true);
    mKaleido.getClient.mockReturnValue({ maker, rln } as any);
    mFlash.isInitialized.mockReturnValue(false);
    source = buildSwapToolSource();
  });

  it('binds market + atomic_status + execute_swap, not atomic init/execute; execute_swap is confirm-gated', async () => {
    const defs = await Promise.resolve(source.listTools());
    const names = defs.map((d) => d.name);
    expect(names).toContain('execute_swap');
    expect(names).toContain('kaleidoswap_atomic_status');
    expect(names).not.toContain('kaleidoswap_atomic_init');
    expect(names).not.toContain('kaleidoswap_atomic_execute');
    expect(names).not.toContain('kaleidoswap_place_order');
    expect(defs.find((d) => d.name === 'execute_swap')?.requiresConfirmation).toBe(true);
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

  it('get_quote takes the contract args: ticker ids and a display-unit from_amount', async () => {
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset_id: 'BTC', to_asset_id: 'USDT', from_amount: 0.001 });
    expect(maker.getQuote).toHaveBeenCalledWith({
      from_asset: { asset_id: 'btc', layer: 'BTC_LN', amount: 100_000_000 },
      to_asset: { asset_id: 'rgb:usdt', layer: 'RGB_LN' },
    });
    expect(q.send_amount).toBe(100_000);
  });

  it('get_quote refuses a to_amount quote instead of treating it as the input', async () => {
    await expect(source.execute('kaleidoswap_get_quote', { from_asset_id: 'BTC', to_asset_id: 'USDT', to_amount: 10 }))
      .rejects.toThrow(/from_amount/);
    expect(maker.getQuote).not.toHaveBeenCalled();
  });

  it('execute_swap replays init→validate→whitelist→execute with the quoted ints', async () => {
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    const res: any = await source.execute('execute_swap', { quote_id: 'rfq1' });
    expect(maker.initSwap).toHaveBeenCalledWith({
      rfq_id: 'rfq1', from_asset: 'btc', from_amount: 100_000_000, to_asset: 'rgb:usdt', to_amount: 73_000_000,
    });
    expect(rln.whitelistSwap).toHaveBeenCalledWith('100000000/btc/73000000/rgb:usdt/x/hash1');
    expect(maker.executeSwap).toHaveBeenCalledWith({ swapstring: '100000000/btc/73000000/rgb:usdt/x/hash1', taker_pubkey: '02taker', payment_hash: 'hash1' });
    expect(res.status).toBe('executing');
    expect(res.atomic_id).toBe('hash1');
    const s: any = await source.execute('kaleidoswap_atomic_status', { payment_hash: res.atomic_id });
    expect(s.status).toBe('completed');
  });

  it('aborts before whitelisting if the maker swapstring does not match the quote', async () => {
    maker.initSwap.mockResolvedValueOnce({ swapstring: '999/btc/73000000/rgb:usdt/x/hash1', payment_hash: 'hash1' });
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    await expect(source.execute('execute_swap', { quote_id: 'rfq1' })).rejects.toThrow(/verification failed/i);
    expect(rln.whitelistSwap).not.toHaveBeenCalled();
    expect(maker.executeSwap).not.toHaveBeenCalled();
  });

  it('refuses to swap without a fresh quote', async () => {
    await expect(source.execute('execute_swap', { quote_id: 'nope' })).rejects.toThrow(/no longer available|re-quote/i);
    expect(maker.initSwap).not.toHaveBeenCalled();
  });
});

describe('swap tools — channel capacity preflight', () => {
  let maker: any;
  let rln: any;
  let adapter: any;
  let source: ReturnType<typeof buildSwapToolSource>;
  const btcChannel = (outSat: number, inSat: number) => ({
    channel_id: 'c1', ready: true, is_usable: true,
    outbound_balance_msat: outSat * 1000, next_outbound_htlc_limit_msat: outSat * 1000, inbound_balance_msat: inSat * 1000,
  });
  const usdtChannel = (local: number, remote: number) => ({
    channel_id: 'c2', ready: true, is_usable: true, asset_id: 'rgb:usdt',
    asset_local_amount: local, asset_remote_amount: remote,
    outbound_balance_msat: 10_000_000, next_outbound_htlc_limit_msat: 10_000_000, inbound_balance_msat: 10_000_000,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mNormalize.mockReturnValue([MAKER_PAIR]);
    mBuildFlash.mockReturnValue([]);
    maker = {
      listPairs: jest.fn(async () => ({})),
      getQuote: jest.fn(async () => ({
        rfq_id: 'rfq1',
        from_asset: { asset_id: 'btc', amount: 100_000_000 },
        to_asset: { asset_id: 'rgb:usdt', amount: 73_000_000 },
        price: 73000, fee: { final_fee: 12 }, expires_at: inAMinute(),
      })),
      initSwap: jest.fn(async () => ({ swapstring: '100000000/btc/73000000/rgb:usdt/x/hash1', payment_hash: 'hash1' })),
      executeSwap: jest.fn(async () => ({})),
    };
    rln = { whitelistSwap: jest.fn(async () => undefined), getTakerPubkey: jest.fn(async () => '02taker') };
    adapter = {
      isConnected: () => true,
      listChannels: jest.fn(async () => [btcChannel(200_000, 0), usdtChannel(0, 100_000_000)]),
      getNodeInfo: jest.fn(async () => ({ rgb_htlc_min_msat: 3_000_000 })),
    };
    mManager.getAdapterIfAvailable.mockImplementation((p: any) => (p === 'RGB_LN' ? adapter : null));
    mKaleido.isInitialized.mockReturnValue(true);
    mKaleido.getClient.mockReturnValue({ maker, rln } as any);
    mFlash.isInitialized.mockReturnValue(false);
    source = buildSwapToolSource();
  });

  it('quotes when BTC outbound covers amount + the HTLC minimum and an asset channel can receive', async () => {
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    expect(q.quote_id).toBe('rfq1');
    expect(describeSwapQuote('rfq1')).toMatchObject({ from: 'BTC', to: 'USDT', sendAmount: 100_000, receiveAmount: 73, receiveUnit: 'USDT' });
  });

  it('BTC → asset: refuses before the confirmation when outbound < amount + 3,000 sats, and says what fits', async () => {
    maker.getQuote.mockResolvedValueOnce({
      rfq_id: 'rfq-short',
      from_asset: { asset_id: 'btc', amount: 100_000_000 },
      to_asset: { asset_id: 'rgb:usdt', amount: 73_000_000 },
      expires_at: inAMinute(),
    });
    adapter.listChannels.mockResolvedValue([btcChannel(101_000, 0), usdtChannel(0, 100_000_000)]);
    await expect(source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 }))
      .rejects.toThrow(/can send at most 101,000 sats.*needs 103,000 sats.*Swap at most 98,000 sats/);
    expect(describeSwapQuote('rfq-short')).toBeNull();
  });

  it('BTC → asset: refuses when no asset channel has inbound for the asset', async () => {
    adapter.listChannels.mockResolvedValue([btcChannel(200_000, 0), usdtChannel(0, 1_000_000)]);
    await expect(source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 }))
      .rejects.toThrow(/no channel can receive 73 USDT/);
  });

  it('asset → BTC: refuses when BTC inbound < amount + the HTLC minimum', async () => {
    maker.getQuote.mockResolvedValueOnce({
      rfq_id: 'rfq2',
      from_asset: { asset_id: 'rgb:usdt', amount: 73_000_000 },
      to_asset: { asset_id: 'btc', amount: 100_000_000 },
      expires_at: inAMinute(),
    });
    adapter.listChannels.mockResolvedValue([btcChannel(0, 50_000), usdtChannel(100_000_000, 0)]);
    await expect(source.execute('kaleidoswap_get_quote', { from_asset: 'USDT', to_asset: 'BTC', amount: 73 }))
      .rejects.toThrow(/can receive at most 50,000 sats.*103,000 sats/);
  });

  it('uses the node-reported HTLC minimum', async () => {
    adapter.getNodeInfo.mockResolvedValue({ rgb_htlc_min_msat: 1_000_000 });
    adapter.listChannels.mockResolvedValue([btcChannel(101_000, 0), usdtChannel(0, 100_000_000)]);
    await expect(source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 })).resolves.toBeTruthy();
  });

  it('unreadable channel data does not block', async () => {
    adapter.listChannels.mockRejectedValue(new Error('node offline'));
    await expect(source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 })).resolves.toBeTruthy();
  });

  it('execute_swap re-checks and stops before the maker locks the swap', async () => {
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    adapter.listChannels.mockResolvedValue([]);
    await expect(source.execute('execute_swap', { quote_id: 'rfq1' })).rejects.toThrow(/no channels/);
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

  it('execute_swap executes the pool swap with a floored minAmountOut', async () => {
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDB', amount: 50_000 });
    const res: any = await source.execute('execute_swap', { quote_id: q.quote_id });
    expect(flash.executeSwap).toHaveBeenCalledWith(expect.objectContaining({
      poolId: 'pool1', assetInAddress: 'btc-spark', assetOutAddress: 'usdb-spark',
      amountIn: '50000', minAmountOut: String(Math.floor(36_000_000 * 0.95)),
    }));
    expect(res.status).toBe('completed');
    expect(res.txid).toBe('tx1');
  });

  it('atomic_status reports flashnet swaps as completed (instant settle)', async () => {
    const s: any = await source.execute('kaleidoswap_atomic_status', { atomic_id: 'flashnet-123' });
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

describe('swap confirm re-quote', () => {
  let maker: any;
  let source: ReturnType<typeof buildSwapToolSource>;
  const quoteResp = (rfq: string, toRaw: number, expiresSec: number) => ({
    rfq_id: rfq,
    from_asset: { asset_id: 'btc', amount: 100_000_000 },
    to_asset: { asset_id: 'rgb:usdt', amount: toRaw },
    fee: { final_fee: 1250, fee_asset: 'BTC', fee_asset_precision: 8 },
    expires_at: expiresSec,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mNormalize.mockReturnValue([MAKER_PAIR]);
    mBuildFlash.mockReturnValue([]);
    maker = {
      listPairs: jest.fn(async () => ({})),
      getQuote: jest.fn(),
      initSwap: jest.fn(async () => ({ swapstring: '100000000/btc/72500000/rgb:usdt/x/hash2', payment_hash: 'hash2' })),
      executeSwap: jest.fn(async () => ({})),
    };
    const rln = { whitelistSwap: jest.fn(async () => undefined), getTakerPubkey: jest.fn(async () => '02taker') };
    mManager.getAdapterIfAvailable.mockImplementation((p: any) => (p === 'RGB_LN' ? ({ isConnected: () => true } as any) : null));
    mKaleido.isInitialized.mockReturnValue(true);
    mKaleido.getClient.mockReturnValue({ maker, rln } as any);
    mFlash.isInitialized.mockReturnValue(false);
    source = buildSwapToolSource();
  });

  it('pure helpers: refresh inside the margin, move is the drop in what you receive', () => {
    expect(quoteNeedsRefresh({ expiresAt: 100_000 }, 70_000, 20_000)).toBe(false);
    expect(quoteNeedsRefresh({ expiresAt: 100_000 }, 85_000, 20_000)).toBe(true);
    expect(priceMove(100, 99)).toBeCloseTo(0.01);
    expect(priceMove(100, 101)).toBeLessThan(0);
    expect(priceMove(0, 5)).toBe(0);
  });

  it('exposes fee, layers and expiry for the readback', async () => {
    const exp = inAMinute();
    maker.getQuote.mockResolvedValueOnce(quoteResp('rfqA', 73_000_000, exp));
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    expect(q.fee).toBe(1250);
    expect(q.fee_unit).toBe('sats');
    expect(describeSwapQuote('rfqA')).toMatchObject({ fee: 1250, feeUnit: 'sats', fromLayer: 'BTC_LN', toLayer: 'RGB_LN', expiresAt: exp * 1000 });
  });

  it('keeps a fresh quote as is', async () => {
    maker.getQuote.mockResolvedValueOnce(quoteResp('rfqB', 73_000_000, inAMinute()));
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    const r = await refreshSwapQuoteForConfirm('rfqB', 73);
    expect(r.refreshed).toBe(false);
    expect(r.needsReapproval).toBe(false);
    expect(maker.getQuote).toHaveBeenCalledTimes(1);
  });

  it('re-quotes a quote close to expiry and accepts a move within tolerance', async () => {
    const soon = Math.floor(Date.now() / 1000) + 5;
    maker.getQuote
      .mockResolvedValueOnce(quoteResp('rfqC', 73_000_000, soon))
      .mockResolvedValueOnce(quoteResp('rfqC2', 72_500_000, inAMinute()));
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    const r = await refreshSwapQuoteForConfirm('rfqC', 73);
    expect(r.refreshed).toBe(true);
    expect(r.quote.quoteId).toBe('rfqC');
    expect(r.quote.receiveAmount).toBe(72.5);
    expect(r.needsReapproval).toBe(false);

    await source.execute('execute_swap', { quote_id: 'rfqC' });
    expect(maker.initSwap).toHaveBeenCalledWith(expect.objectContaining({ rfq_id: 'rfqC2', to_amount: 72_500_000 }));
  });

  it('asks again when the fresh price is worse than the tolerance', async () => {
    const soon = Math.floor(Date.now() / 1000) + 5;
    maker.getQuote
      .mockResolvedValueOnce(quoteResp('rfqD', 73_000_000, soon))
      .mockResolvedValueOnce(quoteResp('rfqD2', 71_000_000, inAMinute()));
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    const r = await refreshSwapQuoteForConfirm('rfqD', 73);
    expect(r.move).toBeGreaterThan(0.01);
    expect(r.needsReapproval).toBe(true);
    const again = await refreshSwapQuoteForConfirm('rfqD', r.quote.receiveAmount);
    expect(again.needsReapproval).toBe(false);
  });
});
