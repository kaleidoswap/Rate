const mockEvents: string[] = [];
const mockConnected = new Set<string>();
const mockDelays: Record<string, number> = {};
const mockFail: Record<string, string> = {};
let mockRgbL1Network: string | null = null;

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
  buildRgbL1Config: () => ({}),
  isRgbLibNativeAvailable: () => true,
  isRgbL1Ready: async () => true,
  loadRgbL1Network: async () => mockRgbL1Network,
  loadRgbL1Host: async () => ({}),
  markRgbL1Ready: async () => {},
}));
jest.mock('./rgbLibRn', () => ({ createRgbLibRnModule: jest.fn() }));
jest.mock('./rgbBackup', () => ({
  restoreRgbFromCloud: jest.fn(), runRgbBackup: jest.fn(async () => {}), scheduleRgbBackup: jest.fn(), setRgbBackupContext: jest.fn(),
}));

import { initializeWdkProtocols } from './wdk';

const configs = (...types: string[]) => types.map((type) => ({ type, enabled: true, config: '{}' }));

beforeEach(() => {
  mockEvents.length = 0;
  mockConnected.clear();
  for (const k of Object.keys(mockDelays)) delete mockDelays[k];
  for (const k of Object.keys(mockFail)) delete mockFail[k];
  mockRgbL1Network = null;
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
