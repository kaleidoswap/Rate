const mockGetFeeRates = jest.fn();
jest.mock('./mempool/MempoolClient', () => ({
  MempoolClient: jest.fn().mockImplementation((network: string) => ({ network, getFeeRates: mockGetFeeRates })),
}));

import { MempoolClient } from './mempool/MempoolClient';
import {
  DEFAULT_RGB_FEE_RATES, cancelRgbTransfer, createRgbUtxos, deleteFailedRgbTransfers, deleteRgbTransfer, drainRgbWallet, findRgbReceive,
  getRgbAssetMetadata, inflateRgbAsset, issueRgbAsset, listRgbTransfers, localFilePath, refreshRgbTransfers, rgbAccountNetwork, rgbFeeRates,
  rgbInflationRights,
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

test('cancelling goes to RGB on this phone, or to the node through the engine; never over NWC', async () => {
  const { adapter, account } = device();
  expect(await cancelRgbTransfer(adapter, 4)).toBe(true);
  expect(account.failTransfer).toHaveBeenCalledWith(4);
  const node = { protocolName: 'RGB_LN', isConnected: () => true, executeProtocolOperation: jest.fn(async () => ({ transfers_changed: true })) };
  expect(await cancelRgbTransfer(node, 6)).toBe(true);
  expect(node.executeProtocolOperation).toHaveBeenCalledWith('failTransfers', { batch_transfer_idx: 6, no_asset_only: false, skip_sync: false });
  await expect(cancelRgbTransfer(nwc([]), 4)).rejects.toThrow(/not supported/);
});

const capable = (caps: Record<string, boolean>, extra: Record<string, unknown> = {}) => {
  const d = device();
  Object.assign(d.account, { capabilities: () => caps, ...extra });
  return d;
};

test('failed transfers are removed only where the native build can', async () => {
  const deleteTransfer = jest.fn(async () => true);
  const deleteFailedTransfers = jest.fn(async () => true);
  const { adapter } = capable({ deleteTransfers: true }, { deleteTransfer, deleteFailedTransfers });
  expect(await deleteRgbTransfer(adapter, 3)).toBe(true);
  expect(deleteTransfer).toHaveBeenCalledWith(3);
  await deleteFailedRgbTransfers(adapter);
  expect(deleteFailedTransfers).toHaveBeenCalled();
  await expect(deleteRgbTransfer(capable({}, { deleteTransfer }).adapter, 3)).rejects.toThrow(/not supported/);
});

test('metadata reads from the bridge or the node, in one shape', async () => {
  const getAssetMetadata = jest.fn(async () => ({ assetSchema: 'CFA', name: 'Art', precision: 0, initialSupply: 10, timestamp: 5, media: { filePath: '/m/abc', mime: 'image/jpeg' } }));
  const { adapter } = capable({ metadata: true }, { getAssetMetadata });
  expect(await getRgbAssetMetadata(adapter, 'rgb:art')).toEqual(expect.objectContaining({
    schema: 'CFA', issuedSupply: 10, timestamp: 5, media: { uri: 'file:///m/abc', mime: 'image/jpeg', isImage: true },
  }));
  expect(await getRgbAssetMetadata(device().adapter, 'rgb:art')).toBeNull();
  const node = { protocolName: 'RGB_LN', isConnected: () => true, executeProtocolOperation: jest.fn(async () => ({ asset_schema: 'Nia', ticker: 'USDT', known_circulating_supply: 99 })) };
  expect(await getRgbAssetMetadata(node, 'rgb:usdt')).toEqual(expect.objectContaining({ schema: 'NIA', ticker: 'USDT', issuedSupply: 99 }));
  expect(node.executeProtocolOperation).toHaveBeenCalledWith('getAssetMetadata', { asset_id: 'rgb:usdt' });
});

test('UDA, IFA and CFA with an image issue through the bridge', async () => {
  const issueAssetUda = jest.fn(async () => ({ assetId: 'rgb:nft', ticker: 'NFT', name: 'One' }));
  const issueAssetIfa = jest.fn(async () => ({ assetId: 'rgb:ifa', ticker: 'IFA', name: 'Inf' }));
  const { adapter, account } = capable({ issueUda: true, issueIfa: true }, { issueAssetUda, issueAssetIfa });
  expect(await issueRgbAsset(adapter, { schema: 'UDA', ticker: 'NFT', name: 'One', precision: 0, amounts: [1], mediaPath: 'file:///tmp/my%20pic.png' }))
    .toEqual({ assetId: 'rgb:nft', name: 'One', ticker: 'NFT', precision: 0, supply: 1 });
  expect(issueAssetUda).toHaveBeenCalledWith({ ticker: 'NFT', name: 'One', details: null, precision: 0, mediaFilePath: '/tmp/my pic.png' });
  await issueRgbAsset(adapter, { schema: 'IFA', ticker: 'IFA', name: 'Inf', precision: 2, amounts: [100], inflationAmounts: [400] });
  expect(issueAssetIfa).toHaveBeenCalledWith({ ticker: 'IFA', name: 'Inf', precision: 2, amounts: [100], inflationAmounts: [400] });
  await issueRgbAsset(adapter, { schema: 'CFA', name: 'Art', precision: 0, amounts: [1], mediaPath: '/tmp/a.jpg' });
  expect(account.issueAssetCfa).toHaveBeenLastCalledWith({ name: 'Art', details: null, precision: 0, amounts: [1], filePath: '/tmp/a.jpg' });
  await expect(issueRgbAsset(device().adapter, { schema: 'UDA', ticker: 'N', name: 'N', precision: 0, amounts: [1] })).rejects.toThrow(/cannot issue UDA/);
});

test('inflation and drain only where the native build has them', async () => {
  const inflate = jest.fn(async () => ({ txid: 'inf-tx' }));
  const inflationRights = jest.fn(async () => 500);
  const drainTo = jest.fn(async () => 'drain-tx');
  const { adapter } = capable({ inflate: true, drain: true }, { inflate, inflationRights, drainTo });
  expect(await rgbInflationRights(adapter, 'rgb:ifa')).toBe(500);
  expect(await inflateRgbAsset(adapter, { assetId: 'rgb:ifa', amount: 50, feeRate: 3 })).toBe('inf-tx');
  expect(inflate).toHaveBeenCalledWith({ assetId: 'rgb:ifa', inflationAmounts: [50], feeRate: 3 });
  expect(await drainRgbWallet(adapter, { address: ' tb1qdest ', feeRate: 2 })).toBe('drain-tx');
  expect(drainTo).toHaveBeenCalledWith({ address: 'tb1qdest', feeRate: 2 });
  const plain = capable({}, { inflate, inflationRights, drainTo }).adapter;
  expect(await rgbInflationRights(plain, 'rgb:ifa')).toBe(0);
  await expect(drainRgbWallet(plain, { address: 'tb1q', feeRate: 2 })).rejects.toThrow(/cannot send all/);
});

test('file URIs become paths; the account network reads mainnet for bitcoin', async () => {
  expect(localFilePath('file:///a/b%20c.png')).toBe('/a/b c.png');
  expect(localFilePath('/a/b.png')).toBe('/a/b.png');
  expect(await rgbAccountNetwork({ getConnectionInfo: async () => ({ network: 'bitcoin' }) })).toBe('mainnet');
  expect(await rgbAccountNetwork({ getConnectionInfo: async () => ({ network: 'Mutinynet' }) })).toBe('mutinynet');
  expect(await rgbAccountNetwork(null)).toBeUndefined();
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
