const mockRequest = jest.fn();
const mockLookup = jest.fn();
let mockMethods: string[] = [];

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'nostr+walletconnect://pk?relay=wss://r&secret=s') }));
jest.mock('./NWCExternalClient', () => ({
  parseNwcUri: jest.fn(),
  NWCClient: jest.fn().mockImplementation(() => ({
    getInfo: jest.fn(async () => ({ methods: mockMethods, pubkey: 'pk' })),
    rlnNodeInfo: jest.fn(async () => ({ pubkey: 'node' })),
    request: mockRequest,
    rlnDecodeRgbInvoice: (params: unknown) => mockRequest('rln_decode_rgb_invoice', params),
    rlnSendAsset: (params: unknown) => mockRequest('rln_send_asset', params),
    rlnRgbInvoice: (params: unknown, signal?: AbortSignal) => mockRequest('rln_rgb_invoice', params, { signal }),
    lookupInvoice: mockLookup,
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

 test.each([true, false])('RGB invoice sends required RLN fields (witness=%s)', async (witness) => {
  const adapter = await connected(['rln_node_info', 'rln_rgb_invoice']);
  const now = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  try {
    const signal = new AbortController().signal;
    await adapter.createRgbInvoiceWithSignal({ witness, duration_seconds: 600, min_confirmations: 3 }, signal);
    expect(mockRequest).toHaveBeenLastCalledWith('rln_rgb_invoice', {
      witness, min_confirmations: 3, expiration_timestamp: 1700000600,
    }, { signal });
  } finally { now.mockRestore(); }
});

test('RGB receive address uses the same complete request and preserves explicit expiry', async () => {
  const adapter = await connected(['rln_node_info', 'rln_rgb_invoice']);
  mockRequest.mockResolvedValue({ invoice: 'rgb:invoice' });
  expect((await adapter.getReceiveAddress('rgb:asset')).address).toBe('rgb:invoice');
  expect(mockRequest).toHaveBeenLastCalledWith('rln_rgb_invoice', expect.objectContaining({
    asset_id: 'rgb:asset', witness: true, min_confirmations: 1, expiration_timestamp: expect.any(Number),
  }), { signal: undefined });
  await adapter.createRgbInvoice({ expiration_timestamp: 1800000000, transport_endpoints: ['rpcs://proxy.example/rpc'] });
  expect(mockRequest).toHaveBeenLastCalledWith('rln_rgb_invoice', expect.objectContaining({
    expiration_timestamp: 1800000000, transport_endpoints: ['rpcs://proxy.example/rpc'],
  }), { signal: undefined });
});

test.each(['Witness', 'Blind'])('sends a decoded %s invoice using the RLN recipient map', async type => {
  const adapter = await connected(['rln_node_info']);
  mockRequest.mockResolvedValueOnce({ recipient_id: 'recipient', recipient_type: type, assignment: 'Any', transport_endpoints: ['rpcs://recipient.proxy'] });
  mockRequest.mockResolvedValueOnce({ txid: 'tx' });
  expect(await adapter.sendAsset({ asset_id: 'asset', recipientId: 'rgb:invoice', amount: 42 })).toEqual({ txid: 'tx' });
  expect(mockRequest).toHaveBeenLastCalledWith('rln_send_asset', {
    donation: false, fee_rate: 2, min_confirmations: 1, expiration_timestamp: expect.any(Number),
    recipient_map: { asset: [{ recipient_id: 'recipient', assignment: { Fungible: 42 }, transport_endpoints: ['rpcs://recipient.proxy'], witness_data: type === 'Witness' ? { amount_sat: 1000, blinding: null } : null }] },
  });
});

test.each([
  { asset_id: 'other' }, { expiration_timestamp: 1 }, { assignment: { Fungible: 99 } },
])('rejects mismatched or expired invoices before sending: %j', async extra => {
  const adapter = await connected(['rln_node_info']);
  mockRequest.mockResolvedValueOnce({ recipient_id: 'recipient', recipient_type: 'Blind', assignment: 'Any', ...extra });
  await expect(adapter.sendAsset({ asset_id: 'asset', recipientId: 'rgb:invoice', amount: 42 })).rejects.toThrow();
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test('a payment’s status: settled, failed or expired, and settled when the wallet only gives its time', async () => {
  const adapter = await connected(['pay_invoice', 'lookup_invoice']);
  const read = async (raw: any) => { mockLookup.mockResolvedValueOnce(raw); return (await adapter.getPaymentStatus('h')).status; };
  expect(await read({ state: 'settled' })).toBe('confirmed');
  expect(await read({ settled_at: 1_700_000_000 })).toBe('confirmed');
  expect(await read({ state: 'failed' })).toBe('failed');
  expect(await read({ state: 'expired' })).toBe('failed');
  expect(await read({ state: 'pending' })).toBe('pending');
  expect(mockLookup).toHaveBeenLastCalledWith({ payment_hash: 'h' });
});
