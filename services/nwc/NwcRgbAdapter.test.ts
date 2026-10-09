const mockRequest = jest.fn();
let mockMethods: string[] = [];

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'nostr+walletconnect://pk?relay=wss://r&secret=s') }));
jest.mock('./NWCExternalClient', () => ({
  parseNwcUri: jest.fn(),
  NWCClient: jest.fn().mockImplementation(() => ({
    getInfo: jest.fn(async () => ({ methods: mockMethods, pubkey: 'pk' })),
    rlnNodeInfo: jest.fn(async () => ({ pubkey: 'node' })),
    request: mockRequest,
    close: jest.fn(),
  })),
}));

import { NwcRgbAdapter } from './NwcRgbAdapter';

async function connected(advertised: string[]) {
  mockMethods = advertised;
  const adapter = new NwcRgbAdapter();
  await adapter.connect({ protocol: 'RGB_LN', network: 'signet' } as any);
  return adapter;
}

beforeEach(() => mockRequest.mockReset());

test('optional node methods are used only when the connection advertises them', async () => {
  const adapter = await connected(['pay_invoice', 'rln_node_info', 'rln_list_assets']);
  expect(adapter.hasRlnMethod('rln_list_transfers')).toBe(false);
  expect(await adapter.listTransfers({ asset_id: 'rgb:usdt' })).toEqual({ transfers: [] });
  expect(await adapter.listUnspents()).toEqual({ unspents: [] });
  expect(await adapter.listOnchainTransactions()).toEqual([]);
  await adapter.refreshTransfers();
  await expect(adapter.createRgbUtxos({ num: 2 })).rejects.toThrow(/cannot create UTXOs/);
  expect(mockRequest).not.toHaveBeenCalled();
});

test('advertised node methods list transfers, refresh, list and create UTXOs', async () => {
  const adapter = await connected(['rln_node_info', 'rln_list_transfers', 'rln_refresh_transfers', 'rln_list_unspents', 'rln_create_utxos']);
  mockRequest.mockResolvedValueOnce({ transfers: [{ idx: 1, status: 'Settled' }] });
  expect(await adapter.listTransfers({ asset_id: 'rgb:usdt' })).toEqual({ transfers: [{ idx: 1, status: 'Settled' }] });
  expect(mockRequest).toHaveBeenLastCalledWith('rln_list_transfers', { asset_id: 'rgb:usdt' });
  await adapter.refreshTransfers();
  expect(mockRequest).toHaveBeenLastCalledWith('rln_refresh_transfers', { filter: [], skip_sync: false });
  await adapter.createRgbUtxos({ num: 4, size: 2000, feeRate: 3 });
  expect(mockRequest).toHaveBeenLastCalledWith('rln_create_utxos', { up_to: false, num: 4, size: 2000, fee_rate: 3, skip_sync: false });
});

test('the node’s on-chain history reads in the adapters’ transaction shape', async () => {
  const adapter = await connected(['rln_node_info', 'rln_list_transactions']);
  mockRequest.mockResolvedValueOnce({ transactions: [
    { txid: 'a'.repeat(64), received: 5000, sent: 0, fee: 0, confirmation_time: { timestamp: 1_700_000_000 } },
    { txid: 'b'.repeat(64), received: 1000, sent: 4000, fee: 200 },
  ] });
  const txs = await adapter.listOnchainTransactions();
  expect(txs[0]).toEqual(expect.objectContaining({ id: 'a'.repeat(64), type: 'receive', status: 'confirmed', amount: 5000, timestamp: 1_700_000_000_000 }));
  expect(txs[0].asset.layer).toBe('BTC_L1');
  expect(txs[1]).toEqual(expect.objectContaining({ type: 'send', status: 'pending', amount: 3000 }));
});
