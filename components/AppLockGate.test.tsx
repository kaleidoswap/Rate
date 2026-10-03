import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import SecurityService from '../services/SecurityService';
import { AppLockGate } from './AppLockGate';

jest.mock('../store/hooks', () => ({ useAppSelector: (fn: any) => fn({ settings: { autoLockTimeout: 5 } }) }));
jest.mock('../services/SecurityService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
const rn = require('react-native');
let appStateChange: (state: string) => void;
rn.AppState = { addEventListener: jest.fn((_: string, listener: (state: string) => void) => {
  appStateChange = listener;
  return { remove: jest.fn() };
}) };
const security = { getSecuritySettings: jest.fn(), verifyPin: jest.fn(), authenticateWithBiometric: jest.fn(), getPinLockedUntil: jest.fn(), resetPinFailures: jest.fn() };
const pinSettings = { pinEnabled: true, biometricEnabled: false, biometricType: null };

beforeEach(() => {
  jest.clearAllMocks();
  (SecurityService.getInstance as jest.Mock).mockReturnValue(security);
  security.getSecuritySettings.mockResolvedValue(pinSettings);
  security.verifyPin.mockResolvedValue(true);
  security.authenticateWithBiometric.mockResolvedValue(false);
  security.getPinLockedUntil.mockResolvedValue(0);
});

it('keeps cold start covered on read failure and offers retry', async () => {
  security.getSecuritySettings.mockRejectedValueOnce(new Error('keychain unavailable'));
  const screen = render(<AppLockGate />);
  await waitFor(() => expect(screen.getByLabelText('Retry security check')).toBeTruthy());
  expect(screen.toJSON()).not.toBeNull();
  fireEvent.press(screen.getByLabelText('Retry security check'));
  await waitFor(() => expect(screen.getByText('Enter your PIN to unlock')).toBeTruthy());
  expect(security.verifyPin).not.toHaveBeenCalled();
});

it('unlocks without authentication only after confirming no lock is configured', async () => {
  security.getSecuritySettings.mockResolvedValue({ pinEnabled: false, biometricEnabled: false });
  const screen = render(<AppLockGate />);
  await waitFor(() => expect(screen.toJSON()).toBeNull());
});

it('keeps biometric-only wallets covered when enrollment is unavailable', async () => {
  security.getSecuritySettings.mockResolvedValue({ pinEnabled: false, biometricEnabled: true, biometricType: null });
  const screen = render(<AppLockGate />);
  await waitFor(() => expect(screen.getByLabelText('Retry security check')).toBeTruthy());
  expect(screen.toJSON()).not.toBeNull();
});

it('requires a valid PIN and covers the app again on a failed resume check', async () => {
  const screen = render(<AppLockGate />);
  await waitFor(() => expect(screen.getByText('Enter your PIN to unlock')).toBeTruthy());
  security.verifyPin.mockResolvedValueOnce(false);
  for (const digit of '123456') fireEvent.press(screen.getByLabelText(digit));
  await waitFor(() => expect(screen.getByText('Incorrect PIN')).toBeTruthy());
  for (const digit of '123456') fireEvent.press(screen.getByLabelText(digit));
  await waitFor(() => expect(screen.toJSON()).toBeNull());
  const clock = jest.spyOn(Date, 'now');
  clock.mockReturnValue(1000);
  act(() => appStateChange('background'));
  clock.mockReturnValue(301001);
  security.getSecuritySettings.mockRejectedValueOnce(new Error('unavailable'));
  act(() => appStateChange('active'));
  await waitFor(() => expect(screen.getByLabelText('Retry security check')).toBeTruthy());
  clock.mockRestore();
});

it('unlocks through successful configured biometrics', async () => {
  security.getSecuritySettings.mockResolvedValue({ pinEnabled: false, biometricEnabled: true, biometricType: 'face' });
  security.authenticateWithBiometric.mockResolvedValue(true);
  const screen = render(<AppLockGate />);
  await waitFor(() => expect(screen.toJSON()).toBeNull());
  expect(security.authenticateWithBiometric).toHaveBeenCalledWith('Unlock your wallet', { allowDeviceFallback: true });
});

it('with a wallet PIN, biometrics fall back to that PIN instead of the phone passcode', async () => {
  security.getSecuritySettings.mockResolvedValue({ pinEnabled: true, biometricEnabled: true, biometricType: 'face' });
  const screen = render(<AppLockGate />);
  await waitFor(() => expect(security.authenticateWithBiometric).toHaveBeenCalledWith('Unlock your wallet', { allowDeviceFallback: false }));
  expect(screen.getByText('Enter your PIN to unlock')).toBeTruthy();
});

it('a stored wrong-PIN cooldown still applies after a restart', async () => {
  security.getPinLockedUntil.mockResolvedValue(Date.now() + 60_000);
  const screen = render(<AppLockGate />);
  await waitFor(() => expect(screen.getByText(/Try again in \d+s/)).toBeTruthy());
  for (const digit of '123456') fireEvent.press(screen.getByLabelText(digit));
  expect(security.verifyPin).not.toHaveBeenCalled();
});
