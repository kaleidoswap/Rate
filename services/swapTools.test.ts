// services/swapTools.test.ts
//
// Binding tests for the fund-moving KaleidoSwap + LSPS1 agent tools. These run
// against a MOCKED maker/rln SDK (no node, no network) and verify the parts
// that move money or could go wrong silently:
//   - get_quote unit translation (sats→msat, asset display→raw) + caching
//   - place_order replays the exact tested sequence with the maker-quoted ints
//   - the swapstring anti-tamper check aborts before whitelisting
//   - lsp_create_order assembles the order payload from node + LSP options
//
// On-device end-to-end (a funded RLN node executing a real swap) is NOT covered
// here — that still needs a device smoke test.

import { buildSwapToolSource } from './swapTools';
import { buildLspToolSource } from './lspTools';
import { protocolManager, kaleidoClientManager } from './protocols';

jest.mock('./protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn() },
  kaleidoClientManager: { isInitialized: jest.fn(() => true), getClient: jest.fn() },
}));

const mockedManager = protocolManager as jest.Mocked<typeof protocolManager>;
const mockedClient = kaleidoClientManager as jest.Mocked<typeof kaleidoClientManager>;

// A BTC/USDT pair: BTC precision 8, USDT precision 6.
const RAW_PAIRS = [{
  base_asset: 'BTC', base_asset_id: 'btc', base_precision: 8,
  quote_asset: 'USDT', quote_asset_id: 'rgb:usdt', quote_precision: 6,
  is_active: true, routes: [{ from_layer: 'BTC_LN', to_layer: 'RGB_LN' }],
}];

function makeMaker(overrides: Record<string, jest.Mock> = {}) {
  return {
    listAssets: jest.fn(async () => ({ assets: [{ ticker: 'USDT', asset_id: 'rgb:usdt', precision: 6 }] })),
    listPairs: jest.fn(async () => ({ pairs: RAW_PAIRS })),
    getQuote: jest.fn(async () => ({
      rfq_id: 'rfq1',
      from_asset: { asset_id: 'btc', amount: 100_000_000 }, // 100k sats → 100M msat
      to_asset: { asset_id: 'rgb:usdt', amount: 73_000_000 }, // 73 USDT (p6)
      price: 73000, fee: { final_fee: 12 }, expires_at: 1234,
    })),
    initSwap: jest.fn(async () => ({
      swapstring: '100000000/btc/73000000/rgb:usdt/x/hash1',
      payment_hash: 'hash1',
    })),
    executeSwap: jest.fn(async () => ({})),
    getSwapNodeInfo: jest.fn(async () => ({ pubkey: '02maker' })),
    getOrderHistory: jest.fn(async () => ({ orders: [] })),
    ...overrides,
  };
}
function makeRln() {
  return {
    whitelistSwap: jest.fn(async () => undefined),
    getTakerPubkey: jest.fn(async () => '02taker'),
  };
}

describe('swap tools (KaleidoSwap, on-device)', () => {
  let maker: ReturnType<typeof makeMaker>;
  let rln: ReturnType<typeof makeRln>;
  let source: ReturnType<typeof buildSwapToolSource>;

  beforeEach(() => {
    maker = makeMaker();
    rln = makeRln();
    mockedManager.getAdapterIfAvailable.mockReturnValue({
      isConnected: () => true,
      getSwapStatus: jest.fn(async () => ({ status: 'completed' })),
    } as any);
    mockedClient.isInitialized.mockReturnValue(true);
    mockedClient.getClient.mockReturnValue({ maker, rln } as any);
    source = buildSwapToolSource();
  });

  it('binds market + orders tools, not the atomic group', async () => {
    const names = (await Promise.resolve(source.listTools())).map((t) => t.name);
    expect(names).toContain('kaleidoswap_get_quote');
    expect(names).toContain('kaleidoswap_place_order');
    expect(names).not.toContain('kaleidoswap_atomic_init');
  });

  it('place_order is confirmation-gated; reads are not', async () => {
    const defs = await Promise.resolve(source.listTools());
    expect(defs.find((d) => d.name === 'kaleidoswap_place_order')?.requiresConfirmation).toBe(true);
    expect(defs.find((d) => d.name === 'kaleidoswap_get_quote')?.requiresConfirmation).toBeFalsy();
  });

  it('get_quote converts BTC sats→msat and returns the receive amount in display units', async () => {
    const q: any = await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    expect(maker.getQuote).toHaveBeenCalledWith({
      from_asset: { asset_id: 'btc', layer: 'BTC_LN', amount: 100_000_000 },
      to_asset: { asset_id: 'rgb:usdt', layer: 'RGB_LN' },
    });
    expect(q.quote_id).toBe('rfq1');
    expect(q.receive_amount).toBe(73); // 73_000_000 / 10^6
    expect(q.receive_unit).toBe('USDT');
  });

  it('place_order replays init→validate→whitelist→execute with the maker-quoted ints', async () => {
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    const res: any = await source.execute('kaleidoswap_place_order', { quote_id: 'rfq1' });

    expect(maker.initSwap).toHaveBeenCalledWith({
      rfq_id: 'rfq1', from_asset: 'btc', from_amount: 100_000_000, to_asset: 'rgb:usdt', to_amount: 73_000_000,
    });
    expect(rln.whitelistSwap).toHaveBeenCalledWith('100000000/btc/73000000/rgb:usdt/x/hash1');
    expect(maker.executeSwap).toHaveBeenCalledWith({
      swapstring: '100000000/btc/73000000/rgb:usdt/x/hash1', taker_pubkey: '02taker', payment_hash: 'hash1',
    });
    expect(res.status).toBe('executing');
  });

  it('aborts before whitelisting if the maker swapstring does not match the quote', async () => {
    maker.initSwap.mockResolvedValueOnce({ swapstring: '999/btc/73000000/rgb:usdt/x/hash1', payment_hash: 'hash1' } as any);
    await source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 100_000 });
    await expect(source.execute('kaleidoswap_place_order', { quote_id: 'rfq1' })).rejects.toThrow(/verification failed/i);
    expect(rln.whitelistSwap).not.toHaveBeenCalled();
    expect(maker.executeSwap).not.toHaveBeenCalled();
  });

  it('refuses to place an order without a fresh quote', async () => {
    await expect(source.execute('kaleidoswap_place_order', { quote_id: 'nope' })).rejects.toThrow(/no longer available|re-quote/i);
    expect(maker.initSwap).not.toHaveBeenCalled();
  });

  it('refuses to quote when the RGB wallet is not connected', async () => {
    mockedClient.isInitialized.mockReturnValue(false);
    await expect(source.execute('kaleidoswap_get_quote', { from_asset: 'BTC', to_asset: 'USDT', amount: 1000 }))
      .rejects.toThrow(/connect your rgb/i);
  });
});

describe('LSP tools (LSPS1, on-device)', () => {
  let adapter: any;
  let source: ReturnType<typeof buildLspToolSource>;

  beforeEach(() => {
    adapter = {
      isConnected: () => true,
      getNodeInfo: jest.fn(async () => ({ pubkey: '02client' })),
      getReceiveAddress: jest.fn(async () => ({ address: 'bc1qrefund' })),
      executeProtocolOperation: jest.fn(async (op: string) => {
        if (op === 'getLspInfo') return { options: { min_funding_confirms_within_blocks: 2, min_required_channel_confirmations: 3 } };
        if (op === 'createLspOrder') return { order_id: 'ord1', bolt11_invoice: 'lnbc1', fee_total_sat: 5000 };
        return {};
      }),
    };
    mockedManager.getAdapterIfAvailable.mockReturnValue(adapter);
    mockedClient.getClient.mockReturnValue({ maker: { getLspNetworkInfo: jest.fn(async () => ({ uri: 'x@y:9735' })) } } as any);
    source = buildLspToolSource();
  });

  it('lsp_create_order is confirmation-gated', async () => {
    const defs = await Promise.resolve(source.listTools());
    expect(defs.find((d) => d.name === 'lsp_create_order')?.requiresConfirmation).toBe(true);
  });

  it('lsp_create_order assembles the payload from the node + LSP options', async () => {
    const res: any = await source.execute('lsp_create_order', { lsp_balance_sat: 1_000_000 });
    expect(adapter.executeProtocolOperation).toHaveBeenCalledWith('createLspOrder', expect.objectContaining({
      lsp_balance_sat: 1_000_000,
      client_pubkey: '02client',
      refund_onchain_address: 'bc1qrefund',
      funding_confirms_within_blocks: 2,
      required_channel_confirmations: 3,
      client_balance_sat: 0,
      announce_channel: false,
    }));
    expect(res.order_id).toBe('ord1');
  });

  it('lsp_get_info hits the LSP', async () => {
    await source.execute('lsp_get_info', {});
    expect(adapter.executeProtocolOperation).toHaveBeenCalledWith('getLspInfo', {});
  });
});
