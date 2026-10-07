const mockEvents: string[] = [];
const mockConnected = new Set<string>();
const mockDelays: Record<string, number> = {};
const mockFail: Record<string, string> = {};
let mockRgbL1Network: string | null = null;
let mockCanSwitch = true;
let mockReady = true;
const mockConfigs: any[] = [];
const mockRestorer = jest.fn((_m: string, n: string) => `restore-into-${n}`);

const mockManager = {
  registerAdapter: jest.fn(),
  getAdapterIfAvailable: (p: string) => ({
    isConnected: () => mockConnected.has(p),
    getUnderlyingSparkWallet: () => (p === 'SPARK' ? {} : undefined),
  }),
  getAdapter: (p: string) => mockManager.getAdapterIfAvailable(p),
  connect: async (p: string) => {
    mockEvents.push(`start ${p}`);
    await new Promise((r) => setTimeout(r, mockDelays[p] ?? 0));
    if (mockFail[p]) throw new Error(mockFail[p]);
    mockConnected.add(p);
    mockEvents.push(`done ${p}`);
  },
  disconnect: async (p: string) => { mockConnected.delete(p); mockEvents.push(`disconnect ${p}`); },
};

jest.mock('@kaleidorg/wallet-engine', () => ({
  ProtocolManager: jest.fn(() => mockManager),
  networkTypeToProtocol: (t: string) => ({ spark: 'SPARK', arkade: 'ARKADE', rgb: 'RGB_LN' } as Record<string, string>)[t],
}));
jest.mock('@kaleidorg/wallet-engine/adapters/wdk', () => ({
  registerWdkModule: jest.fn(), RlnWdkAdapter: jest.fn(), ArkadeWdkAdapter: jest.fn(), RgbLibWdkAdapter: jest.fn(),
}));
const mockFlashnetInit = jest.fn(() => new Promise<void>(() => { /* never settles */ }));
jest.mock('@kaleidorg/wallet-engine/adapters/native', () => ({
  kaleidoClientManager: { initialize: jest.fn() },
  flashnetClientManager: { initialize: () => mockFlashnetInit() },
}));
jest.mock('@kaleidorg/wallet-engine/adapters/bark-react-native', () => ({ BarkReactNativeAdapter: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: async () => 'nostr+walletconnect://test' }));
jest.mock('./MobileSparkAdapter', () => ({ MobileSparkAdapter: jest.fn() }));
jest.mock('../nwc/NwcRgbAdapter', () => ({ NwcRgbAdapter: jest.fn(), NWC_CONNECTION_KEY: 'nwc' }));
jest.mock('./arkadeStorage', () => ({ buildArkadeStorage: () => undefined }));
jest.mock('./networkConfig', () => ({ getDefaultArkadeServerUrl: () => 'https://ark.test', resolveSparkNetwork: () => 'regtest' }));
jest.mock('./bark', () => ({ BARK_ENABLED: false, buildBarkConfig: jest.fn(), isBarkNativeAvailable: () => false }));
jest.mock('./barkPreferences', () => ({}));
jest.mock('../kaleidoPay/bark', () => ({ connectBarkToKaleidoPay: jest.fn(), disconnectBarkFromKaleidoPay: jest.fn() }));
jest.mock('../kaleidoPay/payOptions', () => ({ setPayOptions: jest.fn() }));
jest.mock('./rgbL1', () => ({
  RGB_L1_ENABLED: true,
  RGB_L1_NETWORKS: ['mainnet', 'mutinynet'],
  RGB_L1_NETWORK_LABEL: { mainnet: 'Mainnet', mutinynet: 'Mutinynet' },
  RGB_L1_UPDATE_TO_SWITCH: 'Update the app to switch networks.',
  buildRgbL1Config: (_m: string, host: any, folder: string | null) => { const c = { network: host.network, folder }; mockConfigs.push(c); return c; },
  claimRgbL1DataFolder: async (_m: string, n: string) => (n === 'mainnet' ? null : `rgb-${n}`),
  isRgbLibNativeAvailable: () => true,
  isRgbL1NetworkSwitchSupported: () => mockCanSwitch,
  isRgbL1Ready: async () => mockReady,
  loadRgbL1Network: async () => mockRgbL1Network,
  loadRgbL1Host: async (_m: string, n: string) => ({ network: n }),
  markRgbL1Ready: async () => {},
  rgbL1Restorer: (...a: any[]) => (mockRestorer as any)(...a),
  saveRgbL1Network: async (_m: string, n: string | null) => { mockEvents.push(`save ${n}`); mockRgbL1Network = n; },
}));
jest.mock('./rgbLibRn', () => ({ createRgbLibRnModule: jest.fn() }));
const mockRestoreCloud = jest.fn(async (_o: any) => 'no-backup');
jest.mock('./rgbBackup', () => ({
  findRgbCloudBackup: jest.fn(async () => null),
  restoreRgbFromCloud: (o: any) => mockRestoreCloud(o),
  runRgbBackup: jest.fn(async () => { mockEvents.push('backup'); }),
  scheduleRgbBackup: jest.fn(),
  setRgbBackupContext: jest.fn(),
}));

import { initializeWdkProtocols, switchRgbL1Network, syncRgbOnDevice } from './wdk';

const configs = (...types: string[]) => types.map((type) => ({ type, enabled: true, config: '{}' }));

beforeEach(() => {
  mockEvents.length = 0;
  mockConnected.clear();
  for (const k of Object.keys(mockDelays)) delete mockDelays[k];
  for (const k of Object.keys(mockFail)) delete mockFail[k];
  mockRgbL1Network = null;
  mockCanSwitch = true;
  mockReady = true;
  mockConfigs.length = 0;
  mockRestoreCloud.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('accounts connect at the same time, not one after another', async () => {
  mockDelays.SPARK = 30;
  mockDelays.ARKADE = 10;
  const results = await initializeWdkProtocols('seed', configs('spark', 'arkade'));
  expect(mockEvents.slice(0, 2)).toEqual(['start SPARK', 'start ARKADE']);
  expect(mockEvents.indexOf('done ARKADE')).toBeLessThan(mockEvents.indexOf('done SPARK'));
  expect(results.get('SPARK' as any)).toEqual({ success: true });
  expect(results.get('ARKADE' as any)).toEqual({ success: true });
});

test('one failing account does not stop the others', async () => {
  mockFail.ARKADE = 'server down';
  const results = await initializeWdkProtocols('seed', configs('spark', 'arkade'));
  expect(results.get('ARKADE' as any)).toEqual({ success: false, error: 'server down' });
  expect(results.get('SPARK' as any)).toEqual({ success: true });
});

test('startup does not wait for the Spark swap client', async () => {
  const results = await initializeWdkProtocols('seed', configs('spark'));
  expect(mockFlashnetInit).toHaveBeenCalled();
  expect(results.get('SPARK' as any)).toEqual({ success: true });
});

test('RGB on this phone waits for the node and stays off when the node connects', async () => {
  mockRgbL1Network = 'mainnet';
  mockDelays.RGB_LN = 20;
  const results = await initializeWdkProtocols('seed', configs('rgb'));
  expect(results.get('RGB_LN' as any)).toEqual({ success: true });
  expect(results.get('RGB_L1' as any)).toEqual({ success: false, error: expect.stringMatching(/^skipped/) });
  expect(mockEvents).not.toContain('start RGB_L1');
});

test('RGB on this phone connects once the node is known to be unavailable', async () => {
  mockRgbL1Network = 'mainnet';
  mockFail.RGB_LN = 'unreachable';
  const results = await initializeWdkProtocols('seed', configs('rgb', 'spark'));
  expect(mockEvents.indexOf('start RGB_L1')).toBeGreaterThan(mockEvents.indexOf('start RGB_LN'));
  expect(results.get('RGB_L1' as any)).toEqual({ success: true });
});

test('switching networks backs up and closes the current RGB wallet, then opens the other in its own folder', async () => {
  mockRgbL1Network = 'mainnet';
  expect(await syncRgbOnDevice('seed')).toEqual({ success: true });
  expect(mockConfigs.at(-1)).toEqual({ network: 'mainnet', folder: null });
  mockEvents.length = 0;
  expect(await switchRgbL1Network('seed', 'mutinynet')).toEqual({ success: true });
  expect(mockEvents).toEqual(['backup', 'disconnect RGB_L1', 'save mutinynet', 'start RGB_L1', 'done RGB_L1', 'backup']);
  expect(mockConfigs.at(-1)).toEqual({ network: 'mutinynet', folder: 'rgb-mutinynet' });
});

test('a network that never started here restores its own cloud backup into its own folder', async () => {
  mockRgbL1Network = 'mainnet';
  await syncRgbOnDevice('seed');
  mockReady = false;
  expect(await switchRgbL1Network('seed', 'mutinynet')).toEqual({ success: true });
  expect(mockRestoreCloud).toHaveBeenCalledWith(expect.objectContaining({ network: 'mutinynet', restore: 'restore-into-mutinynet' }));
  expect(mockRestorer).toHaveBeenCalledWith('seed', 'mutinynet');
});

test('a network chosen elsewhere is picked up on the next sync', async () => {
  mockRgbL1Network = 'mainnet';
  await syncRgbOnDevice('seed');
  mockRgbL1Network = 'mutinynet';
  mockEvents.length = 0;
  expect(await syncRgbOnDevice('seed')).toEqual({ success: true });
  expect(mockEvents).toEqual(['disconnect RGB_L1', 'start RGB_L1', 'done RGB_L1', 'backup']);
});

test('an app build that cannot switch refuses and leaves the current RGB wallet alone', async () => {
  mockRgbL1Network = 'mainnet';
  await syncRgbOnDevice('seed');
  mockCanSwitch = false;
  mockEvents.length = 0;
  expect(await switchRgbL1Network('seed', 'mutinynet')).toEqual({ success: false, error: 'Update the app to switch networks.' });
  expect(mockEvents).toEqual([]);
  expect(mockRgbL1Network).toBe('mainnet');
});
