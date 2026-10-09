const settings: Record<string, string> = {};
let mockNativeCanSwitch = true;
const mockRestoreBackup = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../modules/kaleido-rgb', () => ({
  isAvailable: () => true,
  supportsSubdir: () => mockNativeCanSwitch,
  restoreBackup: (...a: any[]) => mockRestoreBackup(...a),
}));
jest.mock('../DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({
    getSetting: async (k: string) => settings[k] ?? null,
    setSetting: async (k: string, v: string) => { settings[k] = v; },
  }) },
}));
import { buildRgbL1Config, loadRgbL1Network, rgbBackupPassword, rgbL1Host, rgbL1WalletKey, saveRgbL1Network } from './rgbL1';

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k];
  mockNativeCanSwitch = true;
  mockRestoreBackup.mockClear();
});

test('off until the wallet turns it on, then remembered per seed', async () => {
  expect(await loadRgbL1Network('seed a')).toBeNull();
  await saveRgbL1Network('seed a', 'mainnet');
  expect(await loadRgbL1Network('seed a')).toBe('mainnet');
  expect(await loadRgbL1Network('seed b')).toBeNull();
  await saveRgbL1Network('seed a', null);
  expect(await loadRgbL1Network('seed a')).toBeNull();
  await expect(saveRgbL1Network('seed a', 'liquid' as any)).rejects.toThrow(/Unsupported/);
});

test('a network chosen but never started can still change', async () => {
  const { pinnedRgbL1Network, lockedRgbL1Network } = require('./rgbL1');
  await saveRgbL1Network('seed a', 'mainnet');
  expect(await lockedRgbL1Network('seed a')).toBeNull();
  await saveRgbL1Network('seed a', 'mutinynet');
  expect(await pinnedRgbL1Network('seed a')).toBe('mutinynet');
  expect(await loadRgbL1Network('seed a')).toBe('mutinynet');
});

test('on a build that can’t switch, the network a seed started on stays its RGB network', async () => {
  const { pinnedRgbL1Network, lockedRgbL1Network, markRgbL1Ready } = require('./rgbL1');
  mockNativeCanSwitch = false;
  await saveRgbL1Network('seed a', 'mainnet');
  await markRgbL1Ready('seed a', 'mainnet');
  await saveRgbL1Network('seed a', null);
  expect(await pinnedRgbL1Network('seed a')).toBe('mainnet');
  expect(await lockedRgbL1Network('seed a')).toBe('mainnet');
  await expect(saveRgbL1Network('seed a', 'mutinynet')).rejects.toThrow(/already runs on Mainnet.*Update the app to switch networks/);
  await saveRgbL1Network('seed a', 'mainnet');
  expect(await loadRgbL1Network('seed a')).toBe('mainnet');
  // Turned on before pinning existed: read as its saved network.
  settings[`rgb-l1-network-v1-${rgbL1WalletKey('seed c')}`] = 'mutinynet';
  expect(await pinnedRgbL1Network('seed c')).toBe('mutinynet');
});

test('mainnet uses a public Esplora and the RGB proxy', () => {
  expect(buildRgbL1Config('seed a', rgbL1Host('mainnet'))).toEqual(expect.objectContaining({
    network: 'mainnet', indexerUrl: 'https://blockstream.info/api', transportEndpoint: 'rpcs://proxy.iriswallet.com/0.2/json-rpc',
  }));
});

test('the adapter config carries the network endpoints; keys and backup password never leak the seed', () => {
  const config = buildRgbL1Config('seed a', rgbL1Host('mutinynet'));
  expect(config).toEqual(expect.objectContaining({
    protocol: 'RGB_L1', network: 'mutinynet', indexerUrl: 'https://esplora.signet.kaleidoswap.com',
    transportEndpoint: 'rpcs://proxy.iriswallet.com/0.2/json-rpc',
  }));
  expect(config.dataDir).toBe('.'); // rgb-lib's original folder
  expect(buildRgbL1Config('seed a', rgbL1Host('mutinynet'), 'rgb-mutinynet').dataDir).toBe('rgb-mutinynet');
  expect(rgbL1WalletKey('seed a')).not.toContain('seed');
  expect(rgbBackupPassword('seed a')).toMatch(/^[0-9a-f]{64}$/);
  expect(rgbBackupPassword('seed a')).not.toBe(rgbBackupPassword('seed b'));
});

test('a wallet can use its own indexer and proxy; bad URLs are refused', async () => {
  const { loadRgbL1Host, saveRgbL1Endpoints, validateRgbEndpoint } = require('./rgbL1');
  await saveRgbL1Endpoints('seed a', 'mutinynet', { indexerUrl: 'https://my-esplora.example/', transportEndpoint: 'rpcs://my-proxy.example/0.2/json-rpc' });
  expect(await loadRgbL1Host('seed a', 'mutinynet')).toEqual(expect.objectContaining({ indexerUrl: 'https://my-esplora.example', transportEndpoint: 'rpcs://my-proxy.example/0.2/json-rpc' }));
  expect((await loadRgbL1Host('seed b', 'mutinynet')).indexerUrl).toBe('https://esplora.signet.kaleidoswap.com');
  expect((await loadRgbL1Host('seed a', 'mainnet')).indexerUrl).toBe('https://blockstream.info/api'); // per network
  await saveRgbL1Endpoints('seed a', 'mutinynet', null);
  expect((await loadRgbL1Host('seed a', 'mutinynet')).indexerUrl).toBe('https://esplora.signet.kaleidoswap.com');
  expect(() => validateRgbEndpoint('indexer', 'rpcs://not-an-indexer')).toThrow(/https/);
  expect(() => validateRgbEndpoint('proxy', 'nonsense')).toThrow(/valid/);
});

describe('one RGB wallet per network', () => {
  const rgbL1 = () => require('./rgbL1');
  const key = (seed: string) => rgbL1WalletKey(seed);

  test('mainnet keeps rgb-lib’s original folder when it starts first; Mutinynet always has its own', async () => {
    const { claimRgbL1DataFolder, rgbL1DataFolder, rgbL1HomeNetwork, markRgbL1Ready } = rgbL1();
    expect(await rgbL1DataFolder('seed a', 'mainnet')).toBeNull(); // nothing started yet
    expect(await claimRgbL1DataFolder('seed a', 'mutinynet')).toBe('rgb-mutinynet-signetcustom');
    await markRgbL1Ready('seed a', 'mutinynet');
    expect(await rgbL1HomeNetwork('seed a')).toBeNull(); // Mutinynet claims no home
    expect(await claimRgbL1DataFolder('seed a', 'mainnet')).toBeNull();
    await markRgbL1Ready('seed a', 'mainnet');
    expect(await rgbL1HomeNetwork('seed a')).toBe('mainnet');
    // Never moves, whatever is chosen or started later.
    await saveRgbL1Network('seed a', 'mutinynet');
    expect(await rgbL1DataFolder('seed a', 'mainnet')).toBeNull();
    expect(await rgbL1DataFolder('seed a', 'mutinynet')).toBe('rgb-mutinynet-signetcustom');
    // Per seed: another wallet's first network is its own home.
    expect(await claimRgbL1DataFolder('seed b', 'mainnet')).toBeNull();
  });

  test('a mainnet wallet from an earlier build opens in place, ready, with the same backup', async () => {
    const { rgbL1DataFolder, rgbL1HomeNetwork, isRgbL1Ready, rgbL1DataId } = rgbL1();
    settings[`rgb-l1-pinned-network-v1-${key('seed a')}`] = 'mainnet';
    settings[`rgb-l1-ready-v1-mainnet-${key('seed a')}`] = '1';
    expect(await rgbL1HomeNetwork('seed a')).toBe('mainnet');
    expect(await rgbL1DataFolder('seed a', 'mainnet')).toBeNull();
    expect(await isRgbL1Ready('seed a', 'mainnet')).toBe(true); // no cloud restore over it
    expect(rgbL1DataId('mainnet')).toBe('mainnet'); // same VSS store
    expect(await rgbL1DataFolder('seed a', 'mutinynet')).toBe('rgb-mutinynet-signetcustom');
  });

  test('a Mutinynet wallet an earlier build made as SIGNET is left where it is', async () => {
    const { isRgbL1Ready, rgbL1DataFolder, rgbL1HomeNetwork, rgbL1DataId, readyRgbL1Networks } = rgbL1();
    // Mutinynet (as SIGNET) started first: it holds the original folder.
    settings[`rgb-l1-home-network-v1-${key('seed a')}`] = 'mutinynet';
    settings[`rgb-l1-ready-v1-mutinynet-${key('seed a')}`] = '1';
    expect(rgbL1DataId('mutinynet')).toBe('mutinynet-signetcustom');
    // The custom-signet wallet is new: it restores its own backup on first start, in its own folder.
    expect(await isRgbL1Ready('seed a', 'mutinynet')).toBe(false);
    expect(await readyRgbL1Networks('seed a')).toEqual([]);
    expect(await rgbL1DataFolder('seed a', 'mutinynet')).toBe('rgb-mutinynet-signetcustom');
    // The original folder still holds the SIGNET data, so mainnet keeps a folder of its own.
    expect(await rgbL1HomeNetwork('seed a')).toBe('mutinynet');
    expect(await rgbL1DataFolder('seed a', 'mainnet')).toBe('rgb-mainnet');
    // Same when the home was never saved: inferred from the old SIGNET ready flag.
    settings[`rgb-l1-pinned-network-v1-${key('seed b')}`] = 'mainnet';
    settings[`rgb-l1-ready-v1-mutinynet-${key('seed b')}`] = '1';
    expect(await rgbL1HomeNetwork('seed b')).toBe('mutinynet');
    expect(await rgbL1DataFolder('seed b', 'mainnet')).toBe('rgb-mainnet');
    // An old SIGNET wallet in its own folder (rgb-mutinynet) is never opened again either.
    expect(await rgbL1DataFolder('seed b', 'mutinynet')).not.toBe('rgb-mutinynet');
  });

  test('networks can switch freely once the native build supports it', async () => {
    const { lockedRgbL1Network, markRgbL1Ready, readyRgbL1Networks, isRgbL1NetworkSwitchSupported } = rgbL1();
    expect(isRgbL1NetworkSwitchSupported()).toBe(true);
    await saveRgbL1Network('seed a', 'mainnet');
    await markRgbL1Ready('seed a', 'mainnet');
    expect(await lockedRgbL1Network('seed a')).toBeNull();
    await saveRgbL1Network('seed a', 'mutinynet');
    expect(await loadRgbL1Network('seed a')).toBe('mutinynet');
    expect(await readyRgbL1Networks('seed a')).toEqual(['mainnet']); // ready flags stay per network
  });

  test('a build that can’t open other folders never opens another network in the original one', async () => {
    const { claimRgbL1DataFolder, markRgbL1Ready, isRgbL1NetworkSwitchSupported } = rgbL1();
    mockNativeCanSwitch = false;
    expect(isRgbL1NetworkSwitchSupported()).toBe(false);
    await markRgbL1Ready('seed a', 'mainnet');
    await expect(claimRgbL1DataFolder('seed a', 'mutinynet')).rejects.toThrow(/app update/);
    expect(await claimRgbL1DataFolder('seed a', 'mainnet')).toBeNull();
  });

  test('a restore claims the network’s folder right before writing it', async () => {
    const { rgbL1Restorer, rgbL1HomeNetwork } = rgbL1();
    await rgbL1Restorer('seed a', 'mutinynet')('/cache/b.rgbbackup', 'pw');
    expect(mockRestoreBackup).toHaveBeenLastCalledWith('/cache/b.rgbbackup', 'pw', 'rgb-mutinynet-signetcustom');
    expect(await rgbL1HomeNetwork('seed a')).toBeNull();
    await rgbL1Restorer('seed a', 'mainnet')('/cache/a.rgbbackup', 'pw');
    expect(mockRestoreBackup).toHaveBeenLastCalledWith('/cache/a.rgbbackup', 'pw', null);
    expect(await rgbL1HomeNetwork('seed a')).toBe('mainnet');
  });
});
