jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockSettings = new Map<string, string>();
jest.mock('./DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({
    getSetting: async (k: string) => mockSettings.get(k) ?? null,
    setSetting: async (k: string, v: string) => { mockSettings.set(k, v); },
    getActiveWallet: async () => null,
  }) },
}));
jest.mock('./protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => undefined }, initializeProtocols: jest.fn() }));
const mockNotify = jest.fn();
const mockToken = jest.fn(async (): Promise<string | null> => 'ExponentPushToken[device1]');
jest.mock('./NotificationService', () => ({
  __esModule: true,
  default: { getInstance: () => ({ notifyPaymentReceived: mockNotify, getPushToken: mockToken }) },
}));
const mockHandle = jest.fn();
const mockRegister = jest.fn(async () => {});
const mockRemove = jest.fn(async () => {});
jest.mock('./kaleidoswapMe', () => ({
  getStoredHandle: (...a: unknown[]) => mockHandle(...a),
  registerPushDevice: (...a: unknown[]) => (mockRegister as any)(...a),
  removePushDevice: (...a: unknown[]) => (mockRemove as any)(...a),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordBalances, setPaymentNotificationsEnabled, syncPaymentPush } from './paymentNotifications';

const handle = { name: 'mario', lightningAddress: 'mario@kaleidoswap.me', sparkAddress: 'sp1q', claimedAt: 1 };
beforeEach(async () => { await AsyncStorage.clear(); mockSettings.clear(); jest.clearAllMocks(); mockHandle.mockResolvedValue(handle); });

test('a balance that went up is announced once; the first reading is only a baseline', async () => {
  await recordBalances(1, { SPARK: 1000 }, true);
  expect(mockNotify).not.toHaveBeenCalled();
  await recordBalances(1, { SPARK: 22000 }, true);
  expect(mockNotify).toHaveBeenCalledWith('You received 21,000 sats in Spark', { accounts: ['SPARK'] });
  await recordBalances(1, { SPARK: 22000 }, true);
  expect(mockNotify).toHaveBeenCalledTimes(1);
});

test('in front, or with the setting off, the baseline moves but nothing is announced', async () => {
  await recordBalances(1, { SPARK: 1000 }, true);
  await recordBalances(1, { SPARK: 2000 }, false);
  await setPaymentNotificationsEnabled(false);
  await recordBalances(1, { SPARK: 3000 }, true);
  expect(mockNotify).not.toHaveBeenCalled();
  await setPaymentNotificationsEnabled(true);
  await recordBalances(1, { SPARK: 3500 }, true);
  expect(mockNotify).toHaveBeenCalledWith('You received 500 sats in Spark', expect.anything());
});

test('another wallet starts its own baseline', async () => {
  await recordBalances(1, { SPARK: 1000 }, true);
  await recordBalances(2, { SPARK: 9000 }, true);
  expect(mockNotify).not.toHaveBeenCalled();
});

test('push follows the handle and the setting', async () => {
  expect(await syncPaymentPush(1, true)).toBe('registered');
  expect(mockRegister).toHaveBeenCalledWith(handle, 'ExponentPushToken[device1]', expect.any(String));
  expect(await syncPaymentPush(1, false)).toBe('removed');
  expect(mockRemove).toHaveBeenCalledWith(handle, 'ExponentPushToken[device1]', expect.any(String));
  expect(await syncPaymentPush(1, false)).toBe('unchanged');
});

test('no name or no permission: nothing is registered', async () => {
  mockHandle.mockResolvedValueOnce(null);
  expect(await syncPaymentPush(1, true)).toBe('no-handle');
  mockToken.mockResolvedValueOnce(null);
  expect(await syncPaymentPush(1, true)).toBe('no-permission');
  expect(mockRegister).not.toHaveBeenCalled();
});

test('a released name drops the old registration locally', async () => {
  await syncPaymentPush(1, true);
  mockHandle.mockResolvedValue(null);
  expect(await syncPaymentPush(1, true)).toBe('removed');
  expect(mockRemove).not.toHaveBeenCalled(); // the registry already dropped it with the name
});
