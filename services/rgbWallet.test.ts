const mockGetFeeRates = jest.fn();
jest.mock('./mempool/MempoolClient', () => ({
  MempoolClient: jest.fn().mockImplementation((network: string) => ({ network, getFeeRates: mockGetFeeRates })),
}));

import { MempoolClient } from './mempool/MempoolClient';
import {
  DEFAULT_RGB_FEE_RATES, cancelRgbTransfer, createRgbUtxos, findRgbReceive, issueRgbAsset, listRgbTransfers, refreshRgbTransfers, rgbFeeRates,
} from './rgbWallet';

function device(overrides: Record<string, unknown> = {}) {
  const account = {
    refreshTransfers: jest.fn(async () => true),
    listTransfers: jest.fn(async () => [] as unknown[]),
    failTransfer: jest.fn(async () => true),
    issueAssetCfa: jest.fn(async () => ({ assetId: 'rgb:art', name: 'Art' })),
  };
  const adapter = {
    protocolName: 'RGB_L1', isConnected: () => true, account,
    listUnspents: jest.fn(), createRgbUtxos: jest.fn(async () => ({ success: true })), refreshBalances: jest.fn(),
    issueAssetNia: jest.fn(async () => ({ id: 'rgb:tok', name: 'Token', ticker: 'TOK' })),
    listTransfers: jest.fn(async (_: { asset_id: string }) => ({ transfers: [] as unknown[] })),
    listAssets: jest.fn(async () => [{ id: 'BTC' }, { id: 'rgb:a' }, { id: 'rgb:b' }]),
    getConnectionInfo: jest.fn(async () => ({ network: 'signet' })),
    ...overrides,
  };
  return { adapter, account };
}

const nwc = (methods: string[]) => ({
  protocolName: 'RGB_LN', isConnected: () => true, walletType: () => 'rln', hasRlnMethod: (m: string) => methods.includes(m),
  refreshTransfers: jest.fn(), refreshBalances: jest.fn(), listTransfers: jest.fn(async () => ({ transfers: [] })),
});

test('refreshing goes to the backing that moves transfers forward', async () => {
  const { adapter, account } = device();
  await refreshRgbTransfers(adapter);
  expect(account.refreshTransfers).toHaveBeenCalled();
  expect(adapter.refreshBalances).not.toHaveBeenCalled();
  const node = nwc(['rln_refresh_transfers']);
  await refreshRgbTransfers(node);
  expect(node.refreshTransfers).toHaveBeenCalled();
  const quiet = nwc([]);
  await refreshRgbTransfers(quiet);
  expect(quiet.refreshTransfers).not.toHaveBeenCalled();
});

test('an invoice for a known asset is found in that asset’s transfers', async () => {
  const { adapter } = device();
  adapter.listTransfers.mockResolvedValueOnce({ transfers: [{ idx: 5, kind: 'ReceiveWitness', status: 'WaitingConfirmations', recipient_id: 'rid' }] });
  const found = await findRgbReceive(adapter, { recipientId: 'rid', assetId: 'rgb:a' });
  expect(found?.status).toBe('waiting-confirmations');
  expect(adapter.listTransfers).toHaveBeenCalledWith({ asset_id: 'rgb:a' });
});

test('an any-asset invoice is looked for among unknown assets, then each held asset, one at a time', async () => {
  const { adapter, account } = device();
  let inFlight = 0;
  let maxInFlight = 0;
  adapter.listTransfers.mockImplementation(async ({ asset_id }) => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return { transfers: asset_id === 'rgb:b' ? [{ idx: 9, kind: 'ReceiveBlind', status: 'Settled', recipient_id: 'rid' }] : [] };
  });
  const found = await findRgbReceive(adapter, { recipientId: 'rid', assetId: null });
  expect(account.listTransfers).toHaveBeenCalledWith(null);
  expect(found?.idx).toBe(9);
  expect(adapter.listTransfers).not.toHaveBeenCalledWith({ asset_id: 'BTC' });
  expect(maxInFlight).toBe(1);
});

test('a node without transfer listing reports none', async () => {
  expect(await listRgbTransfers(nwc([]), 'rgb:a')).toEqual([]);
});

test('cancelling is RGB on this phone only', async () => {
  const { adapter, account } = device();
  expect(await cancelRgbTransfer(adapter, 4)).toBe(true);
  expect(account.failTransfer).toHaveBeenCalledWith(4);
  await expect(cancelRgbTransfer(nwc([]), 4)).rejects.toThrow(/not supported/);
});

test('NIA issues through the adapter, CFA through the bridge, and nothing the account lacks', async () => {
  const { adapter, account } = device();
  expect(await issueRgbAsset(adapter, { schema: 'NIA', ticker: 'TOK', name: 'Token', precision: 0, amounts: [100] }))
    .toEqual({ assetId: 'rgb:tok', name: 'Token', ticker: 'TOK', precision: 0, supply: 100 });
  expect(adapter.issueAssetNia).toHaveBeenCalledWith({ ticker: 'TOK', name: 'Token', precision: 0, amounts: [100] });
  expect((await issueRgbAsset(adapter, { schema: 'CFA', name: 'Art', details: 'one of a kind', precision: 0, amounts: [1] })).assetId).toBe('rgb:art');
  expect(account.issueAssetCfa).toHaveBeenCalledWith({ name: 'Art', details: 'one of a kind', precision: 0, amounts: [1] });
  await expect(issueRgbAsset(nwc([]), { schema: 'NIA', ticker: 'T', name: 'T', precision: 0, amounts: [1] })).rejects.toThrow(/cannot issue/);
});

test('UTXOs are created through the adapter method, else the node operation', async () => {
  const { adapter } = device();
  await createRgbUtxos(adapter, { num: 3, size: 3000, feeRate: 2 });
  expect(adapter.createRgbUtxos).toHaveBeenCalledWith({ num: 3, size: 3000, feeRate: 2, upTo: false });
  const op = { executeProtocolOperation: jest.fn() };
  await createRgbUtxos(op, { num: 1, size: 1000, feeRate: 4 });
  expect(op.executeProtocolOperation).toHaveBeenCalledWith('createUtxos', { fee_rate: 4, num: 1, size: 1000, skip_sync: false, up_to: false });
});

test('fee rates come from the account’s network as whole sat/vB, with defaults when unreachable', async () => {
  const { adapter } = device();
  mockGetFeeRates.mockResolvedValueOnce({ fastestFee: 7.2, halfHourFee: 3.1, hourFee: 1.01, economyFee: 1, minimumFee: 1 });
  expect(await rgbFeeRates(adapter)).toEqual({ slow: 2, normal: 4, fast: 8, live: true });
  expect(MempoolClient).toHaveBeenLastCalledWith('mutinynet');
  mockGetFeeRates.mockRejectedValueOnce(new Error('offline'));
  expect(await rgbFeeRates(adapter)).toEqual(DEFAULT_RGB_FEE_RATES);
  expect(await rgbFeeRates({ ...adapter, getConnectionInfo: async () => ({ network: 'regtest' }) })).toEqual(DEFAULT_RGB_FEE_RATES);
});
