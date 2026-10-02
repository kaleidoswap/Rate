const mockSettings = new Map<string, string>();
jest.mock('../DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({
  getSetting: async (key: string) => mockSettings.get(key) ?? null,
  setSetting: async (key: string, value: string) => { mockSettings.set(key, value); },
}) } }));
jest.mock('./bark', () => ({
  barkWalletKey: (seed: string) => `key-${seed}`,
  resolveBarkHostConfig: () => ({ network: 'mainnet', arkServerUrl: 'https://custom-mainnet', esploraUrl: 'https://custom-explorer' }),
  BARK_DEFAULT_ENDPOINTS: { mainnet: { arkServerUrl: 'https://mainnet', esploraUrl: 'https://mainnet-explorer' }, signet: { arkServerUrl: 'https://signet', esploraUrl: 'https://signet-explorer' } },
}));
import { loadBarkHost, saveBarkNetwork, currentBarkHost, recordBarkConnection, barkConnectionMatches, clearBarkConnection } from './barkPreferences';
beforeEach(() => { mockSettings.clear(); clearBarkConnection(); });
test('restores a wallet network with matching endpoints without changing another wallet', async () => {
  await saveBarkNetwork('wallet-a', 'signet');
  expect(await loadBarkHost('wallet-a')).toEqual({ network: 'signet', arkServerUrl: 'https://signet', esploraUrl: 'https://signet-explorer' });
  expect(await loadBarkHost('wallet-b')).toMatchObject({ network: 'mainnet', arkServerUrl: 'https://custom-mainnet' });
});
test('invalid saved networks never fall back to mainnet', async () => {
  mockSettings.set('bark-network-v1-key-wallet-a', 'typo');
  await expect(loadBarkHost('wallet-a')).rejects.toThrow('invalid');
});
test('connection reuse requires the same wallet and endpoints; labels follow the connection', async () => {
  await saveBarkNetwork('wallet-a', 'signet');
  const host = (await loadBarkHost('wallet-a'))!;
  recordBarkConnection('wallet-a', host);
  expect(currentBarkHost()?.network).toBe('signet');
  expect(barkConnectionMatches('wallet-a', host)).toBe(true);
  expect(barkConnectionMatches('wallet-b', host)).toBe(false);
  expect(barkConnectionMatches('wallet-a', { ...host, arkServerUrl: 'https://other' })).toBe(false);
});
