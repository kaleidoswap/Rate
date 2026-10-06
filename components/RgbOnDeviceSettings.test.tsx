import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { RgbOnDeviceSettings } from './RgbOnDeviceSettings';

const mockAdapters: Record<string, any> = {};
const mockInitialize = jest.fn(async () => new Map([['RGB_L1', { success: true }]]));
const mockSave = jest.fn(async () => undefined);
let mockNetwork: string | null = null;
let mockPinned: string | null = null;
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getActiveWallet: async () => ({ id: 7, encrypted_mnemonic: 'seed words' }) }) } }));
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: (p: string) => mockAdapters[p], disconnect: jest.fn(async () => undefined) },
  initializeProtocols: (...a: any[]) => (mockInitialize as any)(...a),
}));
jest.mock('../services/protocols/rgbL1', () => ({
  loadRgbL1Network: async () => mockNetwork,
  saveRgbL1Network: (...a: any[]) => { mockNetwork = a[1]; if (a[1]) mockPinned = a[1]; return (mockSave as any)(...a); },
  pinnedRgbL1Network: async () => mockPinned,
  RGB_L1_DEFAULT_NETWORK: 'mainnet',
  RGB_L1_NETWORKS: ['mainnet', 'mutinynet'],
  RGB_L1_NETWORK_LABEL: { mainnet: 'Mainnet', mutinynet: 'Mutinynet' },
  rgbBackupPassword: () => 'derived-password',
  isRgbLibNativeAvailable: () => true,
  rgbL1Host: () => ({ network: 'mutinynet', indexerUrl: 'https://default-indexer', transportEndpoint: 'rpcs://default-proxy' }),
  loadRgbL1Host: async () => mockHost,
  saveRgbL1Endpoints: (...a: any[]) => (mockSaveEndpoints as any)(...a),
}));
let mockHost = { network: 'mutinynet', indexerUrl: 'https://default-indexer', transportEndpoint: 'rpcs://default-proxy' };
const mockSaveEndpoints = jest.fn(async () => undefined);
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
  mockPinned = null;
  for (const k of Object.keys(mockAdapters)) delete mockAdapters[k];
});

test('turning it on asks first, saves mainnet by default and connects', async () => {
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent(screen.getByLabelText('RGB on this phone'), 'valueChange', true);
  const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('RGB on this phone (beta)');
  expect((Alert.alert as jest.Mock).mock.calls[0][1]).toMatch(/mainnet, with real funds.*keeps its RGB data on Mainnet/);
  mockAdapters.RGB_L1 = { isConnected: () => true, account: { backupRequired: async () => true, backup: jest.fn(async () => undefined) } };
  await act(async () => { buttons[1].onPress(); });
  expect(mockSave).toHaveBeenCalledWith('seed words', 'mainnet');
  expect(mockInitialize).toHaveBeenCalledWith('seed words', []);
  expect(screen.queryByText('Mutinynet')).toBeNull(); // the network is fixed now
  // Connected and changed since the last backup: the cloud row says so and backs up on demand.
  expect(screen.getByText('Changed since the last backup · backs up automatically')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByLabelText('Back up RGB data now')); });
  expect(mockRunBackup).toHaveBeenCalledWith(true);
  // The file export writes rgb-lib's encrypted backup with the seed-derived password.
  await act(async () => { fireEvent.press(screen.getByText('Export backup file')); });
  expect(mockAdapters.RGB_L1.account.backup).toHaveBeenCalledWith(expect.stringMatching(/kaleidoswap-rgb-.*\.rgbbackup$/), 'derived-password');
});

test('the indexer and proxy can be changed per wallet; saving reconnects', async () => {
  mockNetwork = 'mutinynet';
  mockPinned = 'mutinynet';
  mockAdapters.RGB_L1 = { isConnected: () => true, account: { backupRequired: async () => false, backup: jest.fn() } };
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  expect(screen.getByLabelText('RGB indexer URL').props.value).toBe('https://default-indexer');
  fireEvent.changeText(screen.getByLabelText('RGB indexer URL'), 'https://my-esplora.example');
  await act(async () => { fireEvent.press(screen.getByText('Save and reconnect')); });
  expect(mockSaveEndpoints).toHaveBeenCalledWith('seed words', 'mutinynet', { indexerUrl: 'https://my-esplora.example', transportEndpoint: 'rpcs://default-proxy' });
  expect(mockInitialize).toHaveBeenCalledWith('seed words', []);
  await act(async () => { fireEvent.press(screen.getByText('Use defaults')); });
  expect(mockSaveEndpoints).toHaveBeenLastCalledWith('seed words', 'mutinynet', null);
});

test('before the first start the wallet picks mainnet or Mutinynet', async () => {
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Mutinynet'));
  await act(async () => {});
  expect(screen.getByText(/Test bitcoin, no value/)).toBeTruthy();
  fireEvent(screen.getByLabelText('RGB on this phone'), 'valueChange', true);
  const [, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(message).toMatch(/Mutinynet, a test network/);
  await act(async () => { buttons[1].onPress(); });
  expect(mockSave).toHaveBeenCalledWith('seed words', 'mutinynet');
});
