import { RgbLibWdkAdapter, registerWdkModule } from '@kaleidorg/wallet-engine/adapters/wdk';
import { createRgbLibRnModule, libNetwork, rgbLibSubdir } from './rgbLibRn';

// A stand-in for react-native-rgb's native wallet: records calls, returns rgb-lib shapes.
function fakeLib() {
  const wallet = {
    goOnline: jest.fn(async () => undefined),
    getAddress: jest.fn(async () => 'tb1qrgbwallet'),
    getBtcBalance: jest.fn(async () => ({
      vanilla: { settled: 50_000, future: 60_000, spendable: 50_000 },
      colored: { settled: 3_000, future: 3_000, spendable: 3_000 },
    })),
    refresh: jest.fn(async () => ({})),
    sync: jest.fn(async () => undefined),
    listAssets: jest.fn(async () => ({
      nia: [{ assetId: 'rgb:usdt', ticker: 'USDT', name: 'Tether', precision: 6, issuedSupply: 1e12, timestamp: 0, addedAt: 0,
        balance: { settled: 40_500_000, future: 50_500_000, spendable: 40_500_000 } }],
      uda: [], cfa: [], ifa: [],
    })),
    witnessReceive: jest.fn(async () => ({ invoice: 'rgb:~/~/~/tb/w-invoice', recipientId: 'w-rid', expirationTimestamp: 1_900_000_000, batchTransferIdx: 1 })),
    blindReceive: jest.fn(async () => ({ invoice: 'rgb:~/~/~/tb/b-invoice', recipientId: 'b-rid', expirationTimestamp: null, batchTransferIdx: 2 })),
    send: jest.fn(async () => ({ txid: 'send-txid', batchTransferIdx: 3 })),
    sendBtc: jest.fn(async () => 'btc-txid'),
    listTransactions: jest.fn(async () => [{ transactionType: 'USER', txid: 't1', received: 10_000, sent: 0, fee: 0, confirmationTime: 1_700_000_000 }]),
    listTransfers: jest.fn(async () => [{
      idx: 1, batchTransferIdx: 1, createdAt: 1_700_000_000, updatedAt: 1_700_000_100, kind: 'RECEIVE_WITNESS', status: 'WAITING_COUNTERPARTY',
      requestedAssignment: { type: 'FUNGIBLE', amount: 5_000_000 }, assignments: [{ type: 'FUNGIBLE', amount: 5_000_000 }], transportEndpoints: [],
    }]),
    listUnspents: jest.fn(async () => []),
    createUtxos: jest.fn(async () => 5),
    signPsbt: jest.fn(async (p: string) => `signed:${p}`),
    issueAssetNia: jest.fn(),
    backup: jest.fn(async () => undefined),
    backupInfo: jest.fn(async () => true),
    close: jest.fn(async () => undefined),
  };
  const lib = {
    restoreKeys: jest.fn(async (network: string, mnemonic: string) => ({ mnemonic, network, xpub: 'x', accountXpubVanilla: 'v', accountXpubColored: 'c', masterFingerprint: 'f' })),
    decodeInvoice: jest.fn(async () => ({ recipientId: 'their-rid', transportEndpoints: ['rpcs://their-proxy'], invoice: 'i', assignment: { type: 'ANY' }, network: 'SIGNET', expirationTimestamp: null })),
    Wallet: jest.fn(() => wallet),
  };
  return { lib, wallet };
}

const options = { network: 'mutinynet', indexerUrl: 'https://mutinynet.example/api', transportEndpoint: 'rpcs://proxy.example/json-rpc' };

test('maps app networks to rgb-lib networks; Mutinynet is a custom signet', () => {
  expect(libNetwork('mutinynet')).toBe('SIGNET');
  expect(libNetwork('mainnet')).toBe('MAINNET');
  expect(() => libNetwork('liquid')).toThrow(/Unsupported/);
});

test('the account restores keys for the network and goes online at the indexer', async () => {
  const { lib, wallet } = fakeLib();
  const { WalletManagerRgb } = createRgbLibRnModule(() => lib as any);
  const manager = new WalletManagerRgb('seed words', options);
  const account = await manager.getAccount();
  expect(lib.restoreKeys).toHaveBeenCalledWith('SIGNET', 'seed words');
  expect(lib.Wallet).toHaveBeenCalledWith(expect.objectContaining({ mnemonic: 'seed words' }), { network: 'SIGNET' });
  expect(wallet.goOnline).toHaveBeenCalledWith('https://mutinynet.example/api');
  expect(await manager.getAccount()).toBe(account); // one wallet per manager
  await manager.dispose();
  expect(wallet.close).toHaveBeenCalled();
});

test('receive takes the node-style options too, and witness invoices are the default', async () => {
  const { lib, wallet } = fakeLib();
  const account = await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', options).getAccount();
  const invoice = await account.receiveAsset({ asset_id: 'rgb:usdt', min_confirmations: 1, duration_seconds: 3600 });
  expect(wallet.witnessReceive).toHaveBeenCalledWith('rgb:usdt', { type: 'ANY' }, 3600, ['rpcs://proxy.example/json-rpc'], 1);
  expect(invoice).toEqual(expect.objectContaining({ invoice: 'rgb:~/~/~/tb/w-invoice', recipient_id: 'w-rid' }));
  await account.receiveAsset({ assetId: null, amount: 7, witness: false });
  expect(wallet.blindReceive).toHaveBeenCalledWith(null, { type: 'FUNGIBLE', amount: 7 }, null, ['rpcs://proxy.example/json-rpc'], 1);
});

test('send decodes the invoice and pays its recipient over the proxy it names', async () => {
  const { lib, wallet } = fakeLib();
  const account = await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', options).getAccount();
  await account.transfer({ token: 'rgb:usdt', recipient: 'rgb:invoice', amount: 1_000_000, witnessData: { amountSat: 1000 } });
  expect(wallet.send).toHaveBeenCalledWith({
    'rgb:usdt': [{ recipientId: 'their-rid', assignment: { type: 'FUNGIBLE', amount: 1_000_000 }, transportEndpoints: ['rpcs://their-proxy'], witnessData: { amountSat: 1000 } }],
  }, false, 2, 1);
});

test('transfers read like the node’s, and refreshes are throttled', async () => {
  const { lib, wallet } = fakeLib();
  const account = await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', options).getAccount();
  const [t] = await account.listTransfers('rgb:usdt');
  expect(t).toEqual(expect.objectContaining({ kind: 'ReceiveWitness', status: 'WaitingCounterparty', created_at: 1_700_000_000, requested_assignment: expect.objectContaining({ value: 5_000_000 }) }));
  await account.listAssets();
  await account.listAssets();
  expect(wallet.refresh).toHaveBeenCalledTimes(1);
  await account.refreshWallet();
  expect(wallet.refresh).toHaveBeenCalledTimes(2);
});

test('the engine’s RGB_L1 adapter runs on it end to end', async () => {
  const { lib, wallet } = fakeLib();
  registerWdkModule('@utexo/wdk-wallet-rgb', () => createRgbLibRnModule(() => lib as any));
  const adapter = new RgbLibWdkAdapter();
  await adapter.connect({ protocol: 'RGB_L1', mnemonic: 'seed', dataDir: '.', ...options } as any);
  expect(adapter.isConnected()).toBe(true);
  expect(await adapter.getBtcBalance()).toEqual({ confirmed: 50_000, unconfirmed: 10_000, total: 50_000 });
  const assets = await adapter.listAssets();
  expect(assets.map((a) => a.id)).toEqual(['BTC', 'rgb:usdt']);
  expect((await adapter.getReceiveAddress()).address).toBe('tb1qrgbwallet');
  const invoice = await adapter.createInvoice({ asset: 'rgb:usdt', assetAmount: 2_000_000 } as any);
  expect(invoice.invoice).toBe('rgb:~/~/~/tb/w-invoice');
  expect(wallet.witnessReceive).toHaveBeenLastCalledWith('rgb:usdt', { type: 'FUNGIBLE', amount: 2_000_000 }, null, ['rpcs://proxy.example/json-rpc'], 1);
  const txs = await adapter.listTransactions();
  expect(txs[0]).toEqual(expect.objectContaining({ id: 't1', type: 'receive', status: 'confirmed', timestamp: 1_700_000_000_000 }));
  expect((await adapter.sendBtcOnchain({ address: 'tb1qdest', amount: 1000 } as any)).txid).toBe('btc-txid');
  await adapter.disconnect();
  expect(wallet.close).toHaveBeenCalled();
});

test('every change schedules a backup; witness invoices get their output funded; invoices decode in the node’s shape', async () => {
  const { lib, wallet } = fakeLib();
  const onChange = jest.fn();
  const account = await new (createRgbLibRnModule(() => lib as any, { onChange }).WalletManagerRgb)('seed', options).getAccount();
  await account.receiveAsset({ assetId: 'rgb:usdt' });
  await account.sendTransaction({ to: 'tb1q', value: 1000 });
  await account.createUtxos();
  expect(onChange).toHaveBeenCalledTimes(3);
  // A refresh that moved a transfer counts as a change; an idle one doesn't.
  wallet.refresh.mockResolvedValueOnce({ 1: { updatedStatus: 'SETTLED' } } as any);
  await account.refreshWallet();
  expect(onChange).toHaveBeenCalledTimes(4);
  await account.refreshWallet();
  expect(onChange).toHaveBeenCalledTimes(4);
  lib.decodeInvoice.mockResolvedValue({ recipientId: 'wvout:abc', transportEndpoints: [], assetId: 'rgb:usdt', invoice: 'i',
    assignment: { type: 'FUNGIBLE', amount: 500 }, network: 'SIGNET', expirationTimestamp: null } as any);
  await account.transfer({ token: 'rgb:usdt', recipient: 'rgb:witness-invoice', amount: 500 });
  expect(wallet.send).toHaveBeenLastCalledWith({ 'rgb:usdt': [expect.objectContaining({ recipientId: 'wvout:abc', witnessData: { amountSat: 1000 }, transportEndpoints: ['rpcs://proxy.example/json-rpc'] })] }, false, 2, 1);
  expect(onChange).toHaveBeenCalledTimes(5);
  expect(await account.decodeRgbInvoice('rgb:witness-invoice')).toEqual(expect.objectContaining({
    asset_id: 'rgb:usdt', recipient_id: 'wvout:abc', assignment: { type: 'Fungible', value: 500 },
  }));
});

test('a folder name in dataDir opens the wallet in its own folder; anything else uses the original one', async () => {
  expect(rgbLibSubdir('rgb-mutinynet')).toBe('rgb-mutinynet');
  expect(rgbLibSubdir('.')).toBeNull();
  expect(rgbLibSubdir('../escape')).toBeNull();
  expect(rgbLibSubdir(undefined)).toBeNull();
  const { lib } = fakeLib();
  (lib as any).supportsSubdir = () => true;
  await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', { ...options, dataDir: 'rgb-mutinynet' }).getAccount();
  expect(lib.Wallet).toHaveBeenLastCalledWith(expect.anything(), { network: 'SIGNET', subdir: 'rgb-mutinynet' });
  await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', { ...options, dataDir: '.' }).getAccount();
  expect(lib.Wallet).toHaveBeenLastCalledWith(expect.anything(), { network: 'SIGNET' });
});

test('an older native build never opens a wallet meant for its own folder', async () => {
  const { lib } = fakeLib();
  const manager = new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', { ...options, dataDir: 'rgb-mutinynet' });
  await expect(manager.getAccount()).rejects.toThrow(/Update the app/);
  expect(lib.Wallet).not.toHaveBeenCalled();
});

test('rgb-lib calls never overlap, whichever caller makes them', async () => {
  const { lib, wallet } = fakeLib();
  let running = 0;
  let maxRunning = 0;
  const slow = <T,>(value: T) => async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return value;
  };
  wallet.getAddress.mockImplementation(slow('tb1q'));
  wallet.listTransfers.mockImplementation(slow([]) as any);
  wallet.listUnspents.mockImplementation(slow([]) as any);
  wallet.backupInfo.mockImplementation(slow(false));
  wallet.refresh.mockImplementation(slow({}) as any);
  const account = await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', options).getAccount();
  await Promise.all([
    account.getAddress(), account.listTransfers('rgb:usdt'), account.listUnspents(),
    account.backupRequired(), account.refreshTransfers(), account.listTransfers(null),
  ]);
  expect(maxRunning).toBe(1);
});

test('a failed call does not block the ones queued after it', async () => {
  const { lib, wallet } = fakeLib();
  wallet.listUnspents.mockRejectedValueOnce(new Error('indexer down'));
  const account = await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', options).getAccount();
  await expect(account.listUnspents()).rejects.toThrow('indexer down');
  await expect(account.getAddress()).resolves.toBe('tb1qrgbwallet');
});

test('transfers can be refreshed on demand and cancelled; transfers carry their batch and recipient', async () => {
  const { lib, wallet } = fakeLib();
  (wallet as any).failTransfers = jest.fn(async () => true);
  const onChange = jest.fn();
  const account = await new (createRgbLibRnModule(() => lib as any, { onChange }).WalletManagerRgb)('seed', options).getAccount();
  wallet.refresh.mockResolvedValueOnce({ 1: { updatedStatus: 'WAITING_CONFIRMATIONS' } } as any);
  expect(await account.refreshTransfers()).toBe(true);
  expect(await account.refreshTransfers()).toBe(false);
  expect(wallet.refresh).toHaveBeenCalledTimes(2); // on demand: not throttled
  wallet.listTransfers.mockResolvedValueOnce([{ idx: 4, batchTransferIdx: 9, recipientId: 'rid', createdAt: 1, updatedAt: 1, kind: 'SEND',
    status: 'WAITING_COUNTERPARTY', assignments: [], transportEndpoints: [] }] as any);
  expect((await account.listTransfers('rgb:usdt'))[0]).toEqual(expect.objectContaining({ batch_transfer_idx: 9, recipient_id: 'rid' }));
  expect(await account.failTransfer(9)).toBe(true);
  expect((wallet as any).failTransfers).toHaveBeenCalledWith(9, false, false);
  expect(onChange).toHaveBeenCalledTimes(2);
});

test('collectible assets are listed by name next to NIA, and issued with optional details', async () => {
  const { lib, wallet } = fakeLib();
  wallet.listAssets.mockResolvedValue({
    nia: [], uda: [], ifa: [],
    cfa: [{ assetId: 'rgb:art', name: 'Art', precision: 0, issuedSupply: 10, timestamp: 0, addedAt: 0, balance: { settled: 10, future: 10, spendable: 10 } }],
  } as any);
  (wallet as any).issueAssetCfa = jest.fn(async () => ({ assetId: 'rgb:art', name: 'Art' }));
  const account = await new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', options).getAccount();
  const listed = await account.listAssets();
  expect(wallet.listAssets).toHaveBeenCalledWith(['NIA', 'CFA']);
  expect(listed.nia).toEqual([expect.objectContaining({ assetId: 'rgb:art', ticker: 'Art' })]);
  await account.issueAssetCfa({ name: 'Art', details: '', precision: 0, amounts: [10] });
  expect((wallet as any).issueAssetCfa).toHaveBeenCalledWith('Art', null, 0, [10], null);
});
