import type { WalletConnectWalletContext, WalletConnectWalletOptions, WalletConnectSession } from '@utexo/webrgb-walletconnect';
import {
  disconnectWalletConnect, invalidateWalletConnect, pairWalletConnect, restoreWalletConnect,
  setWalletConnectReviewer, walletConnectError, walletConnectSessions,
} from './walletConnect';

const mockStorage = new Map<string, string>();
const mockAccount = { network: 'signet' };
let mockBinding = { key: 'wallet-A-signet', account: mockAccount };
const mockSessions: Record<string, WalletConnectSession> = {};
const mockKit = { rejectSession: jest.fn(async () => undefined), getActiveSessions: () => mockSessions, on: jest.fn(), off: jest.fn(), core: { expirer: { on: jest.fn(), off: jest.fn() } } };
const mockInit = jest.fn(async () => mockKit);
const mockAdapter = { pair: jest.fn(), disconnect: jest.fn(), dispose: jest.fn() };
let mockOptions: WalletConnectWalletOptions;
const mockAuthorize: { guard?: () => void; approve?: (detail: string) => Promise<void> } = {};
jest.mock('@reown/walletkit', () => ({ WalletKit: { init: mockInit } }));
jest.mock('@walletconnect/core', () => ({ Core: class {} }));
jest.mock('@utexo/webrgb-walletconnect', () => ({ createWalletConnectWallet(options: WalletConnectWalletOptions) {
  mockOptions = options; return mockAdapter;
} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => { mockStorage.set(key, value); },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'stable-account' }));
jest.mock('./account', () => ({ currentWebRgbAccount: () => mockBinding }));
jest.mock('./provider', () => ({
  webRgbMethods: () => ['enable', 'getInfo'],
  createWebRgbProvider(_account: unknown, _context: unknown, approve: (detail: string) => Promise<void>, guard: () => void) {
    mockAuthorize.approve = approve; mockAuthorize.guard = guard; return {};
  },
}));

const session: WalletConnectSession = { topic: 'mint', expiry: Date.now() / 1000 + 1000, namespaces: {},
  peer: { metadata: { name: 'My\u202eMint', url: 'https://mint.example/app?private=1' } } };
const signal = new AbortController().signal;
const context: WalletConnectWalletContext = { topic: session.topic, origin: 'https://mint.example', network: 'signet',
  signal, requestSignal: signal, assertAuthorized: jest.fn() };

beforeEach(() => {
  invalidateWalletConnect(); setWalletConnectReviewer(undefined); jest.clearAllMocks();
  mockBinding = { key: 'wallet-A-signet', account: mockAccount }; mockStorage.clear(); delete mockSessions.mint;
  process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID = 'project';
});
afterEach(() => { delete process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID; });

async function connect() {
  await pairWalletConnect('wc:pair');
  mockSessions.mint = session;
  mockOptions.onSessionConnected?.(session);
}

test('restore without saved sessions stays offline while a simultaneous first scan can connect', async () => {
  await restoreWalletConnect();
  expect(mockInit).not.toHaveBeenCalled();
  await Promise.all([restoreWalletConnect(), pairWalletConnect('wc:pair')]);
  expect(mockAdapter.pair).toHaveBeenCalledWith('wc:pair');
});

test('grant is bound to a local wallet, network and account; reconnect works after restart', async () => {
  await connect();
  expect(walletConnectSessions()).toEqual([{ topic: 'mint', name: 'MyMint', url: 'https://mint.example' }]);
  invalidateWalletConnect();
  mockBinding = { ...mockBinding, key: 'wallet-B-signet' };
  await restoreWalletConnect();
  expect(walletConnectSessions()).toEqual([]);
  mockBinding = { ...mockBinding, key: 'wallet-A-signet' };
  await restoreWalletConnect();
  expect(walletConnectSessions()).toHaveLength(1);
  await mockOptions.getProvider(context);
  mockBinding = { ...mockBinding, account: { network: 'signet' } };
  expect(() => mockAuthorize.guard?.()).toThrow('Reopen');
});

test('expiry, rejection and changed account after the confirmation all prevent approval', async () => {
  await connect();
  await mockOptions.getProvider(context);
  const review = jest.fn(async () => false);
  setWalletConnectReviewer(review);
  await expect(mockAuthorize.approve?.('Send five units')).rejects.toMatchObject({ code: 'USER_REJECTED' });
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ url: context.origin, details: ['Send five units', 'signet'], signal }));
  const expired = new AbortController(); expired.abort();
  expect(await mockOptions.approveSession({ name: 'Mint', origin: context.origin, network: 'signet', methods: ['enable'], events: [], verification: 'UNKNOWN', signal: expired.signal })).toBe(false);
  setWalletConnectReviewer(async () => { mockBinding = { ...mockBinding, key: 'wallet-B-signet' }; return true; });
  await expect(mockAuthorize.approve?.('Send five units')).rejects.toMatchObject({ code: 'NOT_ENABLED' });
});

test('revocation persists locally even when the relay disconnect cannot be delivered', async () => {
  await connect(); await mockOptions.getProvider(context);
  mockAdapter.disconnect.mockRejectedValueOnce(new Error('offline'));
  await disconnectWalletConnect('mint');
  expect(walletConnectSessions()).toEqual([]);
  expect(() => mockAuthorize.guard?.()).toThrow('disconnected');
  invalidateWalletConnect(); await restoreWalletConnect();
  expect(walletConnectSessions()).toEqual([]);
});

test('SDK pairing failures do not disclose the pairing URI', async () => {
  mockAdapter.pair.mockRejectedValueOnce(new Error('failed to pair wc:private-key'));
  await expect(pairWalletConnect('wc:private-key')).rejects.toThrow('Scan a fresh WalletConnect');
});

test('responds to an unsupported chain instead of leaving the QR waiting for approval', async () => {
  await pairWalletConnect('wc:pair');
  const entry = mockKit.on.mock.calls.find(([name]) => name === 'session_proposal');
  expect(entry).toBeDefined();
  entry![1]({ id: 12, params: { requiredNamespaces: { eip155: {} } } });
  expect(mockKit.rejectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 12, reason: expect.objectContaining({ code: 5104 }) }));
  expect(walletConnectError()).toContain('WebRGB');
});
