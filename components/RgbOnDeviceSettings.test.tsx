import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { RgbOnDeviceSettings } from './RgbOnDeviceSettings';

const mockAdapters: Record<string, any> = {};
const mockInitialize = jest.fn(async () => new Map([['RGB_L1', { success: true }]]));
const mockSave = jest.fn(async () => undefined);
let mockNetwork: string | null = null;
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getActiveWallet: async () => ({ id: 7, encrypted_mnemonic: 'seed words' }) }) } }));
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: (p: string) => mockAdapters[p], disconnect: jest.fn(async () => undefined) },
  initializeProtocols: (...a: any[]) => (mockInitialize as any)(...a),
}));
jest.mock('../services/protocols/rgbL1', () => ({
  loadRgbL1Network: async () => mockNetwork,
  saveRgbL1Network: (...a: any[]) => { mockNetwork = a[1]; return (mockSave as any)(...a); },
  rgbBackupPassword: () => 'derived-password',
  isRgbLibNativeAvailable: () => true,
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  File: class { exists = false; uri: string; constructor(dir: any, name: string) { this.uri = `${dir.uri}/${name}`; } delete() {} },
}));
const mockRunBackup = jest.fn(async () => undefined);
jest.mock('../services/protocols/rgbBackup', () => ({
  rgbBackupStatus: () => ({ state: 'idle' }),
  onRgbBackupStatus: () => () => undefined,
  runRgbBackup: (...a: any[]) => (mockRunBackup as any)(...a),
}));
jest.mock('../services/ToastService', () => ({ __esModule: true, default: { getInstance: () => ({ success: jest.fn(), error: jest.fn() }) } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockNetwork = null;
  for (const k of Object.keys(mockAdapters)) delete mockAdapters[k];
});

test('turning it on asks first, saves Mutinynet and connects', async () => {
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent(screen.getByLabelText('RGB on this phone'), 'valueChange', true);
  const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('RGB on this phone (beta)');
  mockAdapters.RGB_L1 = { isConnected: () => true, account: { backupRequired: async () => true, backup: jest.fn(async () => undefined) } };
  await act(async () => { buttons[1].onPress(); });
  expect(mockSave).toHaveBeenCalledWith('seed words', 'mutinynet');
  expect(mockInitialize).toHaveBeenCalledWith('seed words', []);
  // Connected and changed since the last backup: the cloud row says so and backs up on demand.
  expect(screen.getByText('Changed since the last backup · backs up automatically')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByLabelText('Back up RGB data now')); });
  expect(mockRunBackup).toHaveBeenCalledWith(true);
  // The file export writes rgb-lib's encrypted backup with the seed-derived password.
  await act(async () => { fireEvent.press(screen.getByText('Export backup file')); });
  expect(mockAdapters.RGB_L1.account.backup).toHaveBeenCalledWith(expect.stringMatching(/kaleidoswap-rgb-.*\.rgbbackup$/), 'derived-password');
});
