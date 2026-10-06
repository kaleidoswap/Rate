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
  await saveRgbL1Network('seed a', 'mutinynet');
  expect(await loadRgbL1Network('seed a')).toBe('mutinynet');
  expect(await loadRgbL1Network('seed b')).toBeNull();
  await saveRgbL1Network('seed a', null);
  expect(await loadRgbL1Network('seed a')).toBeNull();
  await expect(saveRgbL1Network('seed a', 'mainnet' as any)).rejects.toThrow(/Unsupported/);
});

test('the adapter config carries the network endpoints; keys and backup password never leak the seed', () => {
  const config = buildRgbL1Config('seed a', rgbL1Host('mutinynet'));
  expect(config).toEqual(expect.objectContaining({
    protocol: 'RGB_L1', network: 'mutinynet', indexerUrl: 'https://mutinynet.com/api',
    transportEndpoint: 'rpcs://proxy.iriswallet.com/0.2/json-rpc',
  }));
  expect(config.dataDir).toBe(`rgb-l1/${rgbL1WalletKey('seed a')}`);
  expect(rgbL1WalletKey('seed a')).not.toContain('seed');
  expect(rgbBackupPassword('seed a')).toMatch(/^[0-9a-f]{64}$/);
  expect(rgbBackupPassword('seed a')).not.toBe(rgbBackupPassword('seed b'));
});
