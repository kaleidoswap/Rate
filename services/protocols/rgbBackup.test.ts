const mockDownload = jest.fn(async (): Promise<any> => undefined);
const mockWrites: Uint8Array[] = [];
const mockManifest = jest.fn(async (): Promise<any> => undefined);
const mockUpload = jest.fn(async (_c: any, _p: string, data: Uint8Array) => ({ version: 1, size: data.length, chunks: 1, sha256: 'x', createdAt: 123 }));
jest.mock('./rgbVss', () => ({
  createVssClient: jest.fn(() => ({})),
  uploadBackupFile: (...a: any[]) => (mockUpload as any)(...a),
  downloadBackupFile: (...a: any[]) => (mockDownload as any)(...a),
  readBackupManifest: (...a: any[]) => (mockManifest as any)(...a),
  vssSigningKey: () => new Uint8Array(32),
}));
jest.mock('./bark', () => ({ toFilesystemPath: (uri: string) => uri.replace('file://', '') }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  File: class { exists = true; uri: string; constructor(d: any, n: string) { this.uri = `${d.uri}/${n}`; } async bytes() { return new Uint8Array([1, 2, 3]); } write(d: Uint8Array) { mockWrites.push(d); } delete() {} },
}));
import { createVssClient } from './rgbVss';
import { restoreRgbFromCloud, rgbBackupStatus, rgbBackupStoreId, runRgbBackup, scheduleRgbBackup, setRgbBackupContext } from './rgbBackup';

// Like rgb-lib: a backup clears "changed since the last backup".
let changed = true;
const account = { backupRequired: jest.fn(async () => changed), backup: jest.fn(async () => { changed = false; }) };

beforeEach(() => {
  jest.clearAllMocks();
  changed = true;
  setRgbBackupContext({ mnemonic: 'seed', network: 'mutinynet', account: () => account });
});
afterEach(() => setRgbBackupContext(null));

test('a change backs up once after the burst settles, to the wallet’s own store', async () => {
  jest.useFakeTimers();
  scheduleRgbBackup();
  scheduleRgbBackup();
  scheduleRgbBackup();
  await jest.advanceTimersByTimeAsync(4000);
  jest.useRealTimers();
  await runRgbBackup(); // waits for the one in flight
  expect(account.backup).toHaveBeenCalledTimes(1);
  expect(account.backup).toHaveBeenCalledWith(expect.stringMatching(/^\/cache\/rgb-backup-\d+\.rgbbackup$/), expect.stringMatching(/^[0-9a-f]{64}$/));
  expect(createVssClient).toHaveBeenCalledWith('https://vss.kaleidoswap.com/vss', rgbBackupStoreId('seed', 'mutinynet'), expect.any(Uint8Array));
  expect(mockUpload).toHaveBeenCalledWith({}, 'rgb-backup-file', new Uint8Array([1, 2, 3]));
  expect(rgbBackupStatus()).toEqual({ state: 'done', lastBackupAt: 123 });
});

test('nothing changed: no upload; forced: uploads anyway; a failure is kept for Settings', async () => {
  changed = false;
  await runRgbBackup();
  expect(account.backup).not.toHaveBeenCalled();
  await runRgbBackup(true);
  expect(account.backup).toHaveBeenCalledTimes(1);
  mockUpload.mockRejectedValueOnce(new Error('Backup server error (500).'));
  await runRgbBackup(true);
  expect(rgbBackupStatus()).toEqual(expect.objectContaining({ state: 'failed', error: 'Backup server error (500).' }));
});

test('without a connected RGB wallet nothing runs', async () => {
  setRgbBackupContext(null);
  scheduleRgbBackup();
  await runRgbBackup(true);
  expect(account.backup).not.toHaveBeenCalled();
});

describe('restore from the cloud', () => {
  const restore = jest.fn(async (_path: string, _password: string) => undefined);
  beforeEach(() => { mockWrites.length = 0; });

  test('hands the last upload to rgb-lib with the seed-derived password', async () => {
    mockDownload.mockResolvedValueOnce({ data: new Uint8Array([9, 9]), manifest: { createdAt: 456 } });
    expect(await restoreRgbFromCloud({ mnemonic: 'seed', network: 'mainnet', restore })).toBe('restored');
    expect(createVssClient).toHaveBeenLastCalledWith('https://vss.kaleidoswap.com/vss', rgbBackupStoreId('seed', 'mainnet'), expect.any(Uint8Array));
    expect(mockWrites).toEqual([new Uint8Array([9, 9])]);
    expect(restore).toHaveBeenCalledWith(expect.stringMatching(/^\/cache\/rgb-restore-\d+\.rgbbackup$/), expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(rgbBackupStatus()).toEqual({ state: 'done', lastBackupAt: 456 });
  });

  test('no backup yet, or the wallet is already on this phone', async () => {
    expect(await restoreRgbFromCloud({ mnemonic: 'seed', network: 'mainnet', restore })).toBe('no-backup');
    expect(restore).not.toHaveBeenCalled();
    mockDownload.mockResolvedValueOnce({ data: new Uint8Array([1]), manifest: { createdAt: 1 } });
    const exists = jest.fn(async () => { throw Object.assign(new Error('Wallet dir already exists'), { code: 'WalletDirAlreadyExists' }); });
    expect(await restoreRgbFromCloud({ mnemonic: 'seed', network: 'mainnet', restore: exists })).toBe('already-on-phone');
  });

  test('a backup that can’t be read is an error, never "no backup"', async () => {
    mockDownload.mockRejectedValueOnce(new Error('Backup server error (503).'));
    await expect(restoreRgbFromCloud({ mnemonic: 'seed', network: 'mainnet', restore })).rejects.toThrow(/503/);
    mockDownload.mockResolvedValueOnce({ data: new Uint8Array([1]), manifest: { createdAt: 1 } });
    const bad = jest.fn(async () => { throw new Error('Invalid password'); });
    await expect(restoreRgbFromCloud({ mnemonic: 'seed', network: 'mainnet', restore: bad })).rejects.toThrow(/password/);
  });
});

describe('restore from a file', () => {
  const { restoreRgbFromFile } = require('./rgbBackup');
  test('hands the file to rgb-lib with the seed-derived password', async () => {
    const restore = jest.fn(async () => undefined);
    await restoreRgbFromFile({ mnemonic: 'seed', path: '/docs/kaleidoswap-rgb.rgbbackup', restore });
    expect(restore).toHaveBeenCalledWith('/docs/kaleidoswap-rgb.rgbbackup', expect.stringMatching(/^[0-9a-f]{64}$/));
  });
  test('explains the usual failures', async () => {
    const exists = jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'WalletDirAlreadyExists' }); });
    await expect(restoreRgbFromFile({ mnemonic: 'seed', path: '/f', restore: exists })).rejects.toThrow(/already has RGB data/);
    const wrong = jest.fn(async () => { throw new Error('Invalid password'); });
    await expect(restoreRgbFromFile({ mnemonic: 'seed', path: '/f', restore: wrong })).rejects.toThrow(/isn’t for this wallet/);
  });
});

describe('looking for a cloud backup', () => {
  const { findRgbCloudBackup } = require('./rgbBackup');
  test('reads only the manifest of the network’s own store', async () => {
    expect(await findRgbCloudBackup('seed', 'mutinynet')).toBeNull();
    mockManifest.mockResolvedValueOnce({ version: 1, size: 3, chunks: 1, sha256: 'x', createdAt: 789 });
    expect(await findRgbCloudBackup('seed', 'mainnet')).toEqual(expect.objectContaining({ createdAt: 789 }));
    expect(createVssClient).toHaveBeenLastCalledWith('https://vss.kaleidoswap.com/vss', rgbBackupStoreId('seed', 'mainnet'), expect.any(Uint8Array));
    expect(mockDownload).not.toHaveBeenCalled();
  });
  test('a server it can’t reach is an error, never "no backup"', async () => {
    mockManifest.mockRejectedValueOnce(new Error('Backup server error (503).'));
    await expect(findRgbCloudBackup('seed', 'mainnet')).rejects.toThrow(/503/);
  });
});
