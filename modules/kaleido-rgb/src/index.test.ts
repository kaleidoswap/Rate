const mockNative: Record<string, jest.Mock> = {};
let mockAvailable = true;
jest.mock('./native', () => ({ getNativeModule: () => (mockAvailable ? mockNative : null) }));

import {
  DEFAULT_RECEIVE_SECONDS, DEFAULT_SEND_SECONDS, RgbLibError, Wallet, decodeInvoice, expiresAt, isAvailable, isRgbLibError,
  legacyBdkCacheAction, restoreBackup, restoreKeys, rgbErrorCode, toRgbLibError,
} from './index';
import type { Keys } from './types';

const keys: Keys = {
  mnemonic: 'seed words', xpub: 'xpub', accountXpubVanilla: 'vanilla', accountXpubColored: 'colored',
  masterFingerprint: 'a1b2c3d4', witnessVersion: 'TAPROOT',
};
const freshDir = { exists: false, hasManifest: false, hasBdkDb: false, hasLegacyBdkBackup: false };

beforeEach(() => {
  mockAvailable = true;
  for (const k of Object.keys(mockNative)) delete mockNative[k];
  Object.assign(mockNative, {
    rgbLibVersion: jest.fn(() => '0.3.0-beta.7'),
    restoreKeys: jest.fn(async () => keys),
    restoreBackup: jest.fn(async () => undefined),
    decodeInvoice: jest.fn(async () => ({ recipientId: 'rid' })),
    walletDirState: jest.fn(async () => freshDir),
    moveAsideLegacyBdkCache: jest.fn(async () => 'bdk_db.pre-beta7'),
    openWallet: jest.fn(async () => 7),
    closeWallet: jest.fn(async () => undefined),
    goOnline: jest.fn(async () => undefined),
    sync: jest.fn(async () => undefined),
    witnessReceive: jest.fn(async () => ({ invoice: 'rgb:inv', recipientId: 'wvout:x', expirationTimestamp: 1, batchTransferIdx: 1 })),
    blindReceive: jest.fn(async () => ({ invoice: 'rgb:inv', recipientId: 'utxob:x', expirationTimestamp: 1, batchTransferIdx: 2 })),
    send: jest.fn(async () => ({ txid: 't', batchTransferIdx: 3, entropy: '1' })),
    failTransfers: jest.fn(async () => true),
    issueAssetCfa: jest.fn(async () => ({ assetId: 'rgb:cfa' })),
    listUnspents: jest.fn(async () => []),
  });
});

describe('opening a wallet', () => {
  test('passes the keys, network, folder and the defaults earlier builds used', async () => {
    const wallet = new Wallet(keys, { network: 'SIGNET_CUSTOM', subdir: 'rgb-mutinynet-signetcustom' });
    await wallet.goOnline('https://esplora.example');
    expect(mockNative.walletDirState).toHaveBeenCalledWith({ subdir: 'rgb-mutinynet-signetcustom', masterFingerprint: 'a1b2c3d4' });
    expect(mockNative.openWallet).toHaveBeenCalledWith({
      network: 'SIGNET_CUSTOM',
      subdir: 'rgb-mutinynet-signetcustom',
      maxAllocationsPerUtxo: 1,
      supportedSchemas: ['CFA', 'NIA', 'UDA'],
      keys: {
        accountXpubVanilla: 'vanilla', accountXpubColored: 'colored', masterFingerprint: 'a1b2c3d4',
        mnemonic: 'seed words', witnessVersion: 'TAPROOT', vanillaKeychain: 0,
      },
    });
    // goOnline runs the consistency check (full scan) unless told otherwise.
    expect(mockNative.goOnline).toHaveBeenCalledWith(7, { indexerUrl: 'https://esplora.example', skipConsistencyCheck: false, vanillaSyncLookback: 20 });
    expect(mockNative.moveAsideLegacyBdkCache).not.toHaveBeenCalled();
  });

  test('opens once, however many calls race for it, and close releases the handle', async () => {
    const wallet = new Wallet(keys, { network: 'MAINNET' });
    await Promise.all([wallet.goOnline('u'), wallet.listUnspents(true), wallet.goOnline('u')]);
    expect(mockNative.openWallet).toHaveBeenCalledTimes(1);
    expect(mockNative.listUnspents).toHaveBeenCalledWith(7, { settledOnly: true, skipSync: false });
    await wallet.close();
    expect(mockNative.closeWallet).toHaveBeenCalledWith(7);
    await wallet.close();
    expect(mockNative.closeWallet).toHaveBeenCalledTimes(1);
  });

  test('no folder means the data folder itself; a bad folder name never reaches native code', async () => {
    await new Wallet(keys, { network: 'MAINNET' }).goOnline('u');
    expect(mockNative.openWallet).toHaveBeenCalledWith(expect.objectContaining({ subdir: null }));
    expect(() => new Wallet(keys, { network: 'MAINNET', subdir: '../escape' })).toThrow(RgbLibError);
  });
});

describe('wallets from rgb-lib before 0.3.0-beta.7 (the old BDK cache)', () => {
  test('only a folder with a BDK cache and no manifest is migrated', () => {
    expect(legacyBdkCacheAction(freshDir)).toBe('none');
    expect(legacyBdkCacheAction({ ...freshDir, exists: true, hasBdkDb: true })).toBe('move-aside');
    // Opened by beta.7 before: the manifest says so; never touch its cache.
    expect(legacyBdkCacheAction({ ...freshDir, exists: true, hasBdkDb: true, hasManifest: true })).toBe('none');
    // Moved aside already, but the open failed before the manifest was written: nothing to move.
    expect(legacyBdkCacheAction({ ...freshDir, exists: true, hasLegacyBdkBackup: true })).toBe('none');
  });

  test('moves the cache aside before rgb-lib opens the wallet, and says so', async () => {
    const calls: string[] = [];
    mockNative.walletDirState.mockImplementation(async () => { calls.push('state'); return { ...freshDir, exists: true, hasBdkDb: true }; });
    mockNative.moveAsideLegacyBdkCache.mockImplementation(async () => { calls.push('move'); return 'bdk_db.pre-beta7'; });
    mockNative.openWallet.mockImplementation(async () => { calls.push('open'); return 9; });
    const wallet = new Wallet(keys, { network: 'MAINNET' });
    await wallet.goOnline('https://blockstream.info/api');
    expect(calls).toEqual(['state', 'move', 'open']);
    expect(mockNative.moveAsideLegacyBdkCache).toHaveBeenCalledWith({ subdir: null, masterFingerprint: 'a1b2c3d4' });
    expect(wallet.migratedLegacyBdkCache).toBe('bdk_db.pre-beta7');
    expect(mockNative.goOnline).toHaveBeenCalledWith(9, expect.objectContaining({ skipConsistencyCheck: false }));
  });
});

describe('calls', () => {
  test('receive invoices expire a day out by default (rgb-lib now requires an expiry)', async () => {
    const now = Date.now();
    const wallet = new Wallet(keys, { network: 'MAINNET' });
    await wallet.witnessReceive(null, { type: 'ANY' }, null, ['rpcs://proxy'], 1);
    const args = mockNative.witnessReceive.mock.calls[0][1];
    expect(args).toEqual(expect.objectContaining({ assetId: null, assignment: { type: 'ANY' }, transportEndpoints: ['rpcs://proxy'], minConfirmations: 1 }));
    expect(args.expirationTimestamp).toBeGreaterThanOrEqual(Math.floor(now / 1000) + DEFAULT_RECEIVE_SECONDS);
    await wallet.blindReceive('rgb:a', { type: 'FUNGIBLE', amount: 5 }, 600, [], 1);
    expect(mockNative.blindReceive.mock.calls[0][1].expirationTimestamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 600);
  });

  test('expiresAt: seconds from now; none or 0 (once "never") takes the default', () => {
    expect(expiresAt(60, 100, 1_000_000)).toBe(1_060);
    expect(expiresAt(null, 100, 1_000_000)).toBe(1_100);
    expect(expiresAt(0, 100, 1_000_000)).toBe(1_100);
  });

  test('send: recipients by asset; an unacknowledged transfer expires an hour out unless told', async () => {
    const wallet = new Wallet(keys, { network: 'MAINNET' });
    const recipient = { recipientId: 'wvout:x', assignment: { type: 'FUNGIBLE' as const, amount: 10 }, transportEndpoints: ['rpcs://p'], witnessData: { amountSat: 1000 } };
    await wallet.send({ 'rgb:a': [recipient] }, false, 2, 1);
    const args = mockNative.send.mock.calls[0][1];
    expect(args).toEqual(expect.objectContaining({ recipientMap: { 'rgb:a': [recipient] }, donation: false, feeRate: 2, minConfirmations: 1 }));
    expect(args.expirationTimestamp - Math.floor(Date.now() / 1000)).toBeGreaterThan(DEFAULT_SEND_SECONDS - 5);
    await wallet.send({}, true, 3, 2, 123);
    expect(mockNative.send.mock.calls[1][1].expirationTimestamp).toBe(123);
  });

  test('sync without options fast-syncs both keychains', async () => {
    const wallet = new Wallet(keys, { network: 'MAINNET' });
    await wallet.sync();
    expect(mockNative.sync.mock.calls.map((c) => c[1])).toEqual([
      { keychain: 'COLORED', strategy: 'FAST_SYNC' },
      { keychain: 'VANILLA', strategy: 'FAST_SYNC', lookback: 20 },
    ]);
    await wallet.sync({ keychain: 'COLORED', strategy: 'FULL_SCAN' });
    expect(mockNative.sync).toHaveBeenLastCalledWith(7, { keychain: 'COLORED', strategy: 'FULL_SCAN' });
  });

  test('UTXO and issuance calls keep their positional shape', async () => {
    const wallet = new Wallet(keys, { network: 'MAINNET' });
    await wallet.failTransfers(4);
    expect(mockNative.failTransfers).toHaveBeenCalledWith(7, { batchTransferIdx: 4, noAssetOnly: false, skipSync: false });
    await wallet.issueAssetCfa('Art', null, 0, [1], '/tmp/art.png');
    expect(mockNative.issueAssetCfa).toHaveBeenCalledWith(7, { name: 'Art', details: null, precision: 0, amounts: [1], filePath: '/tmp/art.png' });
  });

  test('module functions: Taproot keys by default (what every earlier wallet used), restore into a folder', async () => {
    await restoreKeys('MAINNET', 'seed words');
    expect(mockNative.restoreKeys).toHaveBeenCalledWith({ network: 'MAINNET', mnemonic: 'seed words', witnessVersion: 'TAPROOT' });
    await restoreBackup('/cache/b', 'pw', 'rgb-mainnet');
    expect(mockNative.restoreBackup).toHaveBeenCalledWith({ backupPath: '/cache/b', password: 'pw', subdir: 'rgb-mainnet' });
    await restoreBackup('/cache/b', 'pw');
    expect(mockNative.restoreBackup).toHaveBeenLastCalledWith({ backupPath: '/cache/b', password: 'pw', subdir: null });
    expect(await decodeInvoice('rgb:inv')).toEqual({ recipientId: 'rid' });
  });
});

describe('errors', () => {
  test('native rejections become RgbLibErrors with rgb-lib’s error name', async () => {
    mockNative.restoreBackup.mockRejectedValue(Object.assign(new Error('WalletDirAlreadyExists: path=/data/a1b2c3d4'), { code: 'ERR_RGB_WALLET_DIR_ALREADY_EXISTS' }));
    const err = await restoreBackup('/b', 'pw').catch((e) => e);
    expect(err).toBeInstanceOf(RgbLibError);
    expect(err.code).toBe('ERR_RGB_WALLET_DIR_ALREADY_EXISTS');
    expect(err.variant).toBe('WalletDirAlreadyExists');
    expect(err.message).toMatch(/WalletDirAlreadyExists/); // what the app's restore checks match on
    expect(isRgbLibError(err, 'WalletDirAlreadyExists')).toBe(true);
    expect(isRgbLibError(err, 'WrongPassword')).toBe(false);
  });

  test('codes are stable; bridge errors carry no rgb-lib name; anything else is ERR_RGB_NATIVE', () => {
    expect(rgbErrorCode('InsufficientBitcoins')).toBe('ERR_RGB_INSUFFICIENT_BITCOINS');
    expect(rgbErrorCode('Io')).toBe('ERR_RGB_IO');
    expect(toRgbLibError(Object.assign(new Error('call goOnline first'), { code: 'ERR_RGB_NOT_ONLINE' }))).toEqual(expect.objectContaining({ code: 'ERR_RGB_NOT_ONLINE', variant: null }));
    expect(toRgbLibError(new Error('boom')).code).toBe('ERR_RGB_NATIVE');
    expect(toRgbLibError('weird').message).toBe('weird');
  });

  test('a build without the native module says so', async () => {
    mockAvailable = false;
    expect(isAvailable()).toBe(false);
    await expect(restoreKeys('MAINNET', 'x')).rejects.toMatchObject({ code: 'ERR_RGB_UNAVAILABLE' });
  });
});
