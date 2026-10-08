import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import SecuritySetupScreen from './SecuritySetupScreen';

const mockSecurity = {
  getSecuritySettings: jest.fn(),
  verifyPin: jest.fn(),
  getPinLockedUntil: jest.fn(async () => 0),
  resetPinFailures: jest.fn(async () => undefined),
  authenticateWithBiometric: jest.fn(async () => true),
  removePin: jest.fn(async () => true),
  savePin: jest.fn(async () => true),
  setBiometricEnabled: jest.fn(async () => true),
};
jest.mock('../services/SecurityService', () => ({ __esModule: true, default: { getInstance: () => mockSecurity } }));
jest.mock('../components', () => ({
  Button: () => null,
  ScreenHeader: ({ title, onBack }: any) => { const { Text, TouchableOpacity } = require('react-native'); return <TouchableOpacity accessibilityLabel="Back" onPress={onBack}><Text>{title}</Text></TouchableOpacity>; },
}));

const navigation = { goBack: jest.fn(), replace: jest.fn() };
const renderMode = async (mode: 'pin' | 'disablePin') => {
  const screen = render(<SecuritySetupScreen navigation={navigation} route={{ params: { mode } }} />);
  await act(async () => {});
  return screen;
};
const typePin = async (screen: ReturnType<typeof render>, pin: string) => {
  for (const d of pin) await act(async () => { fireEvent.press(screen.getByLabelText(d)); });
  await act(async () => { jest.advanceTimersByTime(300); });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (require('react-native') as any).Vibration = { vibrate: jest.fn() };
  mockSecurity.getSecuritySettings.mockResolvedValue({ pinEnabled: true, biometricEnabled: false, biometricType: 'face' });
  mockSecurity.verifyPin.mockImplementation(async (pin: string) => pin === '111111');
});
afterEach(() => jest.useRealTimers());

test('turning off the PIN needs the current PIN; a wrong one changes nothing', async () => {
  const screen = await renderMode('disablePin');
  expect(screen.getByText('Enter current PIN')).toBeTruthy();
  await typePin(screen, '222222');
  expect(screen.getByText('Incorrect PIN')).toBeTruthy();
  expect(mockSecurity.removePin).not.toHaveBeenCalled();
  await typePin(screen, '111111');
  expect(mockSecurity.removePin).toHaveBeenCalled();
  expect(navigation.goBack).toHaveBeenCalled();
});

test('a running wrong-PIN cooldown is shown instead of a plain error', async () => {
  mockSecurity.getPinLockedUntil.mockResolvedValueOnce(Date.now() + 30_000);
  const screen = await renderMode('disablePin');
  await typePin(screen, '222222');
  expect(screen.getByText(/Too many attempts/)).toBeTruthy();
});

test('changing the PIN verifies the current one, then saves the confirmed new PIN and leaves biometrics alone', async () => {
  const screen = await renderMode('pin');
  await typePin(screen, '111111');
  expect(screen.getByText('New PIN')).toBeTruthy();
  await typePin(screen, '654321');
  expect(screen.getByText('Confirm PIN')).toBeTruthy();
  await typePin(screen, '654321');
  expect(mockSecurity.savePin).toHaveBeenCalledWith('654321');
  expect(mockSecurity.setBiometricEnabled).not.toHaveBeenCalled();
  expect(navigation.goBack).toHaveBeenCalled();
});

test('enabled biometrics can stand in for the current PIN', async () => {
  mockSecurity.getSecuritySettings.mockResolvedValue({ pinEnabled: true, biometricEnabled: true, biometricType: 'face' });
  require('expo-local-authentication').supportedAuthenticationTypesAsync.mockResolvedValueOnce([2]);
  const screen = await renderMode('disablePin');
  await act(async () => { fireEvent.press(screen.getByLabelText('Use Face ID')); });
  expect(mockSecurity.authenticateWithBiometric).toHaveBeenCalledWith(expect.any(String), { allowDeviceFallback: false });
  expect(mockSecurity.removePin).toHaveBeenCalled();
});

test('without biometrics enabled there is no biometric shortcut', async () => {
  const screen = await renderMode('disablePin');
  expect(screen.queryByLabelText('Use Face ID')).toBeNull();
});

test('setting a first PIN goes straight to the new PIN', async () => {
  mockSecurity.getSecuritySettings.mockResolvedValue({ pinEnabled: false, biometricEnabled: true, biometricType: 'face' });
  const screen = await renderMode('pin');
  expect(screen.getByText('New PIN')).toBeTruthy();
  await typePin(screen, '123123');
  await typePin(screen, '123123');
  expect(mockSecurity.verifyPin).not.toHaveBeenCalled();
  expect(mockSecurity.savePin).toHaveBeenCalledWith('123123');
});
