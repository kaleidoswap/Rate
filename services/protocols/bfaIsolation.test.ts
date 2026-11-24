import { isAvailable } from '../features';
import { DEFAULT_ACCOUNTS, hasAnyAccount, saveAccountPreferences, SETUP_ACCOUNTS, walletNetworksFor } from './accountChoices';
import { rgbBackupStoreId } from './rgbBackup';
import { buildRgbL1Config, loadRgbL1Host, loadRgbL1Network, RGB_L1_DEFAULT_NETWORK, RGB_L1_NETWORKS, rgbL1Host, saveRgbL1Network } from './rgbL1';

const mockSettings = new Map<string, string>();
jest.mock('../buildVariant', () => ({ BFA_TEST_BUILD: true }));
jest.mock('../DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({
  getSetting: (key: string) => Promise.resolve(mockSettings.get(key) ?? null),
  setSetting: (key: string, value: string) => Promise.resolve(mockSettings.set(key, value)),
}) } }));

const testWallet = 'isolated-wallet-fixture';

beforeEach(() => mockSettings.clear());

it('sets up or restores only RGB on Mutinynet', async () => {
  expect(SETUP_ACCOUNTS.map(account => account.key)).toEqual(['rgbOnDevice']);
  expect(DEFAULT_ACCOUNTS).toEqual({ spark: false, arkade: false, bark: false, rgbOnDevice: true });
  expect(walletNetworksFor({ spark: true, arkade: true, bark: true, rgbOnDevice: true })).toEqual([]);
  expect(hasAnyAccount({ spark: true, arkade: false, bark: false, rgbOnDevice: false }, true)).toBe(false);
  expect(isAvailable('rgbOnDevice', 'beta')).toBe(true);
  expect(isAvailable('nwc', 'dev')).toBe(false);

  await saveAccountPreferences(testWallet, DEFAULT_ACCOUNTS);
  await expect(loadRgbL1Network(testWallet)).resolves.toBe('mutinynet');
});

it('rejects any other RGB network even with an explicit config or saved preference', async () => {
  expect(RGB_L1_DEFAULT_NETWORK).toBe('mutinynet');
  expect(RGB_L1_NETWORKS).toEqual(['mutinynet']);
  const host = rgbL1Host('mutinynet');
  expect(host).toEqual({
    network: 'mutinynet',
    indexerUrl: 'https://esplora.signet.kaleidoswap.com',
    transportEndpoint: 'rpcs://proxy.iriswallet.com/1.0/json-rpc',
  });
  expect(() => buildRgbL1Config(testWallet, { ...host, network: 'mainnet' })).toThrow('Unsupported RGB network.');
  await expect(loadRgbL1Host(testWallet, 'mainnet')).rejects.toThrow('Unsupported RGB network.');
  await expect(saveRgbL1Network(testWallet, 'mainnet')).rejects.toThrow('Unsupported RGB network.');

  await saveRgbL1Network(testWallet, 'mutinynet');
  for (const key of mockSettings.keys()) mockSettings.set(key, 'mainnet');
  await expect(loadRgbL1Network(testWallet)).resolves.toBeNull();
});

it('uses a separate cloud backup namespace for the same test wallet', () => {
  expect(rgbBackupStoreId(testWallet, 'mutinynet-signetcustom')).toMatch(/^bfa-test-rgb-l1-file-/);
});
