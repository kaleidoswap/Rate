const mockUpload = jest.fn(async (_c: any, _p: string, data: Uint8Array) => ({ version: 1, size: data.length, chunks: 1, sha256: 'x', createdAt: 123 }));
jest.mock('./rgbVss', () => ({
  createVssClient: jest.fn(() => ({})),
  uploadBackupFile: (...a: any[]) => (mockUpload as any)(...a),
  vssSigningKey: () => new Uint8Array(32),
}));
jest.mock('./bark', () => ({ toFilesystemPath: (uri: string) => uri.replace('file://', '') }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  File: class { exists = true; uri: string; constructor(d: any, n: string) { this.uri = `${d.uri}/${n}`; } async bytes() { return new Uint8Array([1, 2, 3]); } delete() {} },
}));
import { createVssClient } from './rgbVss';
import { rgbBackupStatus, rgbBackupStoreId, runRgbBackup, scheduleRgbBackup, setRgbBackupContext } from './rgbBackup';

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
