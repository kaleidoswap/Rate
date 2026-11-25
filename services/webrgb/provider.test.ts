import type { RgbLibRnAccount } from '../protocols/rgbLibRn';
import type { WalletConnectWalletContext } from '@utexo/webrgb-walletconnect';
import { createWebRgbProvider, webRgbMethods } from './provider';
import { getReceivedMint, supportsReceivedMint } from './mint';

jest.mock('@react-native-async-storage/async-storage', () => {
  const items = new Map<string, string>();
  return { setItem: async (k: string, v: string) => { items.set(k, v); }, getItem: async (k: string) => items.get(k) ?? null };
});
jest.mock('./mint', () => ({ getReceivedMint: jest.fn(), supportsReceivedMint: jest.fn() }));

const amount = { settled: 100, spendable: 95, future: 115 };
const invoice = 'rgb:asset/42/sbc:wvout:dest';
const assetId = 'rgb:asset';
const recipientId = 'sbc:wvout:dest';

function setup(origin = 'https://mint.test', network = 'mutinynet') {
  const account = {
    ownerKey: 'test-owner', signMessage: jest.fn(() => 'signature'), getAddress: jest.fn(async () => 'tb1ptest'),
    inspectInvoice: jest.fn().mockResolvedValue({ recipientId, network: 'SIGNET_CUSTOM', assetId,
      assignment: { type: 'FUNGIBLE', amount: 42 }, transportEndpoints: ['rpcs://test'] }),
    listAssets: jest.fn().mockResolvedValue({ nia: [{ assetId, ticker: 'USD', name: 'Dollar', precision: 2, balance: amount }] }),
    receiveAsset: jest.fn(async () => ({ invoice, recipientId, expirationTimestamp: 9999 })),
    supportsUtxoReview: () => true,
    createReviewedUtxos: jest.fn(async (_num: number, size: number, _rate: number,
      review: (tx: { feeSat: number; outputs: { amountSat: number; address: string }[] }) => Promise<void>) => {
      await review({ feeSat: 268, outputs: [{ amountSat: size, address: 'tb1qcolor' }, { amountSat: 8900, address: 'tb1qchange' }] });
      return 1;
    }), transfer: jest.fn(async () => ({ txid: 'tx', batchTransferIdx: 7 })),
    syncedBtcBalance: jest.fn(async () => ({ vanilla: amount, colored: amount })),
    listUnspents: jest.fn().mockResolvedValue([
      { utxo: { exists: true, colorable: true, outpoint: 'private' }, rgbAllocations: [], pendingBlinded: 0 },
      { utxo: { exists: true, colorable: true }, rgbAllocations: [], pendingBlinded: 1 },
    ]),
    listTransfers: jest.fn().mockResolvedValue([{ batchTransferIdx: 7, kind: 'Send', amount: 42, status: 'Settled', recipientId, consignmentPath: '/private/proof' }]),
    refreshTransfers: jest.fn(async () => false),
  };
  const assertAuthorized = jest.fn();
  const assertActive = jest.fn();
  const approve = jest.fn(async (_details: string) => {});
  const provider = createWebRgbProvider(account as unknown as RgbLibRnAccount,
    { network, origin, assertAuthorized } as unknown as WalletConnectWalletContext, approve, assertActive);
  return { provider, account, approve, assertActive, assertAuthorized };
}

beforeEach(() => jest.resetAllMocks());

it('reports native methods only, and returns public balances without outpoints', async () => {
  const { provider, account, approve } = setup();
  expect((await provider.getInfo()).methods).toEqual(webRgbMethods(account as unknown as RgbLibRnAccount));
  expect((await provider.getInfo()).methods).not.toContain('getReceivedMint');
  expect(await provider.getBtcBalance!()).toEqual({ vanilla: amount, colored: amount, freeColorableUtxos: 1 });
  expect(await provider.listAssets!()).toEqual([{ id: assetId, ticker: 'USD', name: 'Dollar', precision: 2, balance: amount }]);
  expect(approve).not.toHaveBeenCalled();
});

it('only polls a capable mint backend with the full invoice and no extra claims', async () => {
  (supportsReceivedMint as jest.Mock).mockReturnValue(true);
  const { provider, account, approve } = setup();
  expect((await provider.getInfo()).methods).toContain('getReceivedMint');
  await provider.witnessReceive!({});
  approve.mockClear();
  await provider.getReceivedMint!({ invoice });
  const other = setup('https://other.test').provider;
  await expect(other.getReceivedMint!({ invoice })).rejects.toMatchObject({ code: 'NOT_ENABLED' });
  await expect(other.getReceivedMint!({ invoice: 'rgb:foreign/invoice' })).rejects.toMatchObject({ code: 'NOT_ENABLED' });
  expect(getReceivedMint).toHaveBeenCalledWith(account, invoice, expect.any(Function));
  await expect(provider.getReceivedMint!({ invoice, assetId } as { invoice: string })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  expect(getReceivedMint).toHaveBeenCalledTimes(1);
  expect(approve).not.toHaveBeenCalled();
});

it('creates any-asset witness invoices after showing the confirmation floor, and refuses unknown assets', async () => {
  const { provider, account, approve } = setup();
  await expect(provider.witnessReceive!({ minConfirmations: 1 })).resolves.toEqual({ invoice, recipientId, expirationTimestamp: 9999, minConfirmations: 3 });
  expect(approve.mock.calls[0][0]).toMatch(/witness RGB invoice[\s\S]+any RGB asset[\s\S]+Confirmations: 3/);
  expect(account.receiveAsset).toHaveBeenCalledWith({ witness: true, minConfirmations: 3 }, expect.any(Function));
  await expect(provider.blindReceive!({ assetId: 'rgb:unknown' })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  expect(account.receiveAsset).toHaveBeenCalledTimes(1);
});

it('serves Utexo Mint’s first-asset Signet receive and pre-deposit receipt lookup', async () => {
  (supportsReceivedMint as jest.Mock).mockReturnValue(true);
  (getReceivedMint as jest.Mock).mockResolvedValue(null);
  const { account, approve, provider } = setup('https://mint.utexo.com', 'signet');
  account.listAssets.mockResolvedValue({ nia: [] });
  const openInvoice = 'rgb:~/sbc:wvout:new-wallet';
  const newRecipient = 'sbc:wvout:new-wallet';
  account.receiveAsset.mockResolvedValue({ invoice: openInvoice, recipientId: newRecipient, expirationTimestamp: 9999 });
  account.inspectInvoice.mockResolvedValue({ recipientId: newRecipient, network: 'SIGNET', assetId: null, assignment: { type: 'ANY' }, transportEndpoints: [] });

  await expect(provider.getAssetBalance!(assetId)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  const receive = await provider.witnessReceive!({ minConfirmations: 3, durationSeconds: 86400 });
  expect(account.receiveAsset).toHaveBeenCalledWith({ witness: true, minConfirmations: 3, durationSeconds: 86400 }, expect.any(Function));
  await expect(provider.decodeRgbInvoice!(receive.invoice)).resolves.toEqual({ amount: null, network: 'signet', recipientId: newRecipient, transportEndpoints: [] });
  await expect(provider.getReceivedMint!({ invoice: receive.invoice })).resolves.toBeNull();
  expect(approve).toHaveBeenCalledTimes(1);
});

it('reviews Mosaik output creation and returns the actual created count', async () => {
  const { provider, approve, account } = setup();
  await expect(provider.createUtxos!({ num: 2, size: 10000, feeRate: 2 })).resolves.toEqual({ created: 1, size: 10000, feeRate: 2 });
  expect(approve.mock.calls[0][0]).toContain('10000 sats → tb1qcolor');
  expect(approve.mock.calls[0][0]).toContain('Mining fee: 268 sats (2 sat/vB)');
  expect(account.createReviewedUtxos).toHaveBeenCalledWith(2, 10000, 2, expect.any(Function), expect.any(Function));
  await expect(provider.createUtxos!({ num: 0 })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  expect(approve).toHaveBeenCalledTimes(1);
});

it('reviews fixed invoice terms on the phone before signing and discloses only public transfer fields', async () => {
  const { provider, approve, account } = setup();
  expect(await provider.sendAsset!({ invoice })).toEqual({ txid: 'tx', transferId: 7, assetId, amount: 42, recipientId });
  expect(approve.mock.calls[0][0]).toContain('Send 0.42 USD (42 base units)');
  expect(approve.mock.calls[0][0]).toContain(recipientId);
  expect(account.transfer).toHaveBeenCalledWith({ token: assetId, recipient: invoice, amount: 42, feeRate: 2, minConfirmations: 3 }, expect.any(Function));
  expect(JSON.stringify(await provider.getTransferStatus!(7, assetId))).not.toContain('/private');
});

it('uses the decoded invoice to pay an explicit amount to the same recipient', async () => {
  const { provider, account } = setup();
  account.inspectInvoice.mockResolvedValue({ assetId, recipientId, network: 'SIGNET_CUSTOM', assignment: { type: 'FUNGIBLE', amount: 0 }, transportEndpoints: [] });
  await expect(provider.decodeRgbInvoice!(invoice)).resolves.toMatchObject({ amount: null });
  await expect(provider.sendAsset!({ invoice })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  await expect(provider.sendAsset!({ recipientId, assetId, amount: 14 })).resolves.toMatchObject({ amount: 14 });
  expect(account.transfer).toHaveBeenCalledTimes(1);
});

it('does not spend after rejection, revocation during approval, or an invoice mismatch', async () => {
  const { provider, account, assertAuthorized, approve } = setup();
  approve.mockRejectedValueOnce(Object.assign(new Error('declined'), { code: 'USER_REJECTED' }));
  await expect(provider.sendAsset!({ invoice })).rejects.toMatchObject({ code: 'USER_REJECTED' });
  await expect(provider.sendAsset!({ assetId, amount: 43, recipientId: invoice })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  approve.mockImplementationOnce(async () => {
    assertAuthorized.mockImplementation(() => { throw Object.assign(new Error('revoked'), { code: 'NOT_ENABLED' }); });
  });
  await expect(provider.sendAsset!({ invoice })).rejects.toMatchObject({ code: 'NOT_ENABLED' });
  expect(account.transfer).not.toHaveBeenCalled();
});

it('signs the unchanged authentication challenge only after review', async () => {
  const { provider, account, approve } = setup();
  const challenge = 'Wallet authentication\n  challenge 🚀 ';
  expect(await provider.signMessage!(challenge)).toEqual({ signature: 'signature' });
  expect(approve.mock.calls[0][0].endsWith(challenge)).toBe(true);
  expect(account.signMessage).toHaveBeenCalledWith(challenge);
  await expect(provider.signMessage!('')).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  expect(account.signMessage).toHaveBeenCalledTimes(1);
});
