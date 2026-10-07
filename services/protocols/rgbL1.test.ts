const settings: Record<string, string> = {};
jest.mock('../DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({
    getSetting: async (k: string) => settings[k] ?? null,
    setSetting: async (k: string, v: string) => { settings[k] = v; },
  }) },
}));
import { buildRgbL1Config, loadRgbL1Network, rgbBackupPassword, rgbL1Host, rgbL1WalletKey, saveRgbL1Network } from './rgbL1';

beforeEach(() => { for (const k of Object.keys(settings)) delete settings[k]; });

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

test('the network a seed started on this phone stays its RGB network', async () => {
  const { pinnedRgbL1Network, lockedRgbL1Network, markRgbL1Ready } = require('./rgbL1');
  await saveRgbL1Network('seed a', 'mutinynet');
  await markRgbL1Ready('seed a', 'mutinynet');
  await saveRgbL1Network('seed a', null);
  expect(await pinnedRgbL1Network('seed a')).toBe('mutinynet');
  expect(await lockedRgbL1Network('seed a')).toBe('mutinynet');
  // rgb-lib keeps one folder per seed: switching would open Mutinynet data as mainnet.
  await expect(saveRgbL1Network('seed a', 'mainnet')).rejects.toThrow(/already runs on Mutinynet/);
  await saveRgbL1Network('seed a', 'mutinynet');
  expect(await loadRgbL1Network('seed a')).toBe('mutinynet');
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
  expect(config.dataDir).toBe(`rgb-l1/${rgbL1WalletKey('seed a')}`);
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
