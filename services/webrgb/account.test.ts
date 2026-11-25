import { currentWebRgbAccount } from './account';
import { rgbL1WalletKey } from '../protocols/rgbL1WalletKey';

const mockApp = { currentState: 'active' };
let mockUnlocked = true;
let mockConnecting = false;
const mockWallet = { isUnlocked: true, activeWallet: { id: 7, encrypted_mnemonic: 'seed' } };
const mockAccount = { ownerKey: '', network: 'signet' };
jest.mock('react-native', () => ({ get AppState() { return mockApp; } }));
jest.mock('../../store/storeProvider', () => ({ getStore: () => ({ getState: () => ({ wallet: mockWallet }) }) }));
jest.mock('../appLockState', () => ({ isAppUnlocked: () => mockUnlocked }));
jest.mock('../protocols/wdk', () => ({ isRgbConnecting: () => mockConnecting }));
jest.mock('../protocols', () => ({ rgbAccountIsOnDevice: () => true, protocolManager: {
  getAdapterIfAvailable: () => ({ isConnected: () => true, account: mockAccount }),
} }));

beforeEach(() => {
  mockApp.currentState = 'active'; mockUnlocked = true; mockConnecting = false;
  mockWallet.isUnlocked = true; mockAccount.ownerKey = rgbL1WalletKey('seed');
});

test('requires both wallet unlock gates and foreground state', () => {
  expect(currentWebRgbAccount().account).toBe(mockAccount);
  mockApp.currentState = 'background'; expect(currentWebRgbAccount).toThrow('unlock');
  mockApp.currentState = 'active'; mockUnlocked = false; expect(currentWebRgbAccount).toThrow('unlock');
  mockUnlocked = true; mockWallet.isUnlocked = false; expect(currentWebRgbAccount).toThrow('unlock');
});

test('cannot act during a network change or with a stale native wallet', () => {
  mockConnecting = true; expect(currentWebRgbAccount).toThrow('RGB');
  mockConnecting = false; mockAccount.ownerKey = rgbL1WalletKey('other seed');
  expect(currentWebRgbAccount).toThrow('RGB');
});
