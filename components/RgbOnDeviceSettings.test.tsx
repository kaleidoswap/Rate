import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { RgbOnDeviceSettings, rgbStartError } from './RgbOnDeviceSettings';

const mockAdapters: Record<string, any> = {};
const mockCalls: string[] = [];
const mockReconcile = jest.fn(async (_opts?: any): Promise<any> => ({ success: true }));
const mockSave = jest.fn(async (_m: string, _n: string | null) => undefined);
const mockReady = jest.fn(async () => undefined);
const mockRestoreFile = jest.fn(async () => undefined);
const mockRestoreCloud = jest.fn(async (): Promise<string> => 'restored');
const mockFindBackup = jest.fn(async (): Promise<any> => null);
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cache/my.rgbbackup' }] })) }));
jest.mock('react-native-rgb', () => ({ restoreBackup: jest.fn() }), { virtual: true });
let mockNetwork: string | null = null;
let mockPinned: string | null = null;
let mockLocked: string | null = null;
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getActiveWallet: async () => ({ id: 7, encrypted_mnemonic: 'seed words' }) }) } }));
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: (p: string) => mockAdapters[p], disconnect: jest.fn(async () => undefined) },
  reconcileRgbOnDevice: (...a: any[]) => { mockCalls.push('reconcile'); return (mockReconcile as any)(...a); },
}));
jest.mock('../services/protocols/rgbL1', () => ({
  loadRgbL1Network: async () => mockNetwork,
  saveRgbL1Network: (...a: any[]) => { mockCalls.push(`save:${a[1]}`); mockNetwork = a[1]; if (a[1]) mockPinned = a[1]; return (mockSave as any)(...a); },
  pinnedRgbL1Network: async () => mockPinned,
  lockedRgbL1Network: async () => mockLocked,
  RGB_L1_DEFAULT_NETWORK: 'mainnet',
  RGB_L1_NETWORKS: ['mainnet', 'mutinynet'],
  RGB_L1_NETWORK_LABEL: { mainnet: 'Mainnet', mutinynet: 'Mutinynet' },
  markRgbL1Ready: (...a: any[]) => { mockCalls.push('ready'); return (mockReady as any)(...a); },
  rgbBackupPassword: () => 'derived-password',
  isRgbLibNativeAvailable: () => true,
  rgbL1Host: () => ({ network: 'mutinynet', indexerUrl: 'https://default-indexer', transportEndpoint: 'rpcs://default-proxy' }),
  loadRgbL1Host: async () => mockHost,
  saveRgbL1Endpoints: (...a: any[]) => (mockSaveEndpoints as any)(...a),
}));
const mockHost = { network: 'mutinynet', indexerUrl: 'https://default-indexer', transportEndpoint: 'rpcs://default-proxy' };
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
  restoreRgbFromFile: (...a: any[]) => { mockCalls.push('restore-file'); return (mockRestoreFile as any)(...a); },
  restoreRgbFromCloud: (...a: any[]) => { mockCalls.push('restore-cloud'); return (mockRestoreCloud as any)(...a); },
  findRgbCloudBackup: (...a: any[]) => (mockFindBackup as any)(...a),
}));
jest.mock('../services/ToastService', () => ({ __esModule: true, default: { getInstance: () => ({ success: jest.fn(), error: jest.fn() }) } }));

const connectedL1 = (backupRequired = false) => ({ isConnected: () => true, account: { backupRequired: async () => backupRequired, backup: jest.fn(async () => undefined) } });
const lastAlert = () => (Alert.alert as jest.Mock).mock.calls.at(-1);
const press = (buttons: any[], text: string) => buttons.find((b) => b.text === text).onPress();

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockNetwork = null;
  mockPinned = null;
  mockLocked = null;
  for (const k of Object.keys(mockAdapters)) delete mockAdapters[k];
  mockFindBackup.mockReset().mockResolvedValue(null);
  mockReconcile.mockReset().mockImplementation(async () => { mockAdapters.RGB_L1 = connectedL1(true); return { success: true }; });
});

test('Connect asks first, finds no cloud backup, then saves mainnet and connects', async () => {
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  expect(screen.getByText('Restore from cloud')).toBeTruthy();
  expect(screen.getByText('Restore from a backup file')).toBeTruthy();
  fireEvent.press(screen.getByText('Connect'));
  const [title, message, buttons] = lastAlert();
  expect(title).toBe('RGB on this phone (beta)');
  expect(message).toMatch(/mainnet, with real funds.*keeps its RGB data on Mainnet once it starts/);
  expect(mockSave).not.toHaveBeenCalled(); // nothing is fixed before the user goes ahead
  await act(async () => { await press(buttons, 'Continue'); });
  expect(mockFindBackup).toHaveBeenCalledWith('seed words', 'mainnet');
  expect(mockCalls).toEqual(['save:mainnet', 'reconcile']);
  expect(mockReconcile).toHaveBeenCalledWith({ skipCloudRestore: true });
  // Connected: status, backups, export and disconnect.
  expect(screen.getByText('Connected · Mainnet')).toBeTruthy();
  expect(screen.queryByText('Mutinynet')).toBeNull();
  expect(screen.getByText('Changed since the last backup · backs up automatically')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByLabelText('Back up RGB data now')); });
  expect(mockRunBackup).toHaveBeenCalledWith(true);
  await act(async () => { fireEvent.press(screen.getByText('Export backup file')); });
  expect(mockAdapters.RGB_L1.account.backup).toHaveBeenCalledWith(expect.stringMatching(/kaleidoswap-rgb-.*\.rgbbackup$/), 'derived-password');
  fireEvent.press(screen.getByText('Disconnect'));
  const [offTitle, , offButtons] = lastAlert();
  expect(offTitle).toBe('Turn off RGB on this phone?');
  await act(async () => { await press(offButtons, 'Turn off'); });
  expect(mockSave).toHaveBeenLastCalledWith('seed words', null);
  expect(mockReconcile).toHaveBeenLastCalledWith();
});

test('before it starts, the network is picked; Mutinynet is saved on connect', async () => {
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Mutinynet'));
  await act(async () => {});
  expect(screen.getByText(/Test bitcoin, no value/)).toBeTruthy();
  fireEvent.press(screen.getByText('Connect'));
  expect(lastAlert()[1]).toMatch(/Mutinynet, a test network/);
  await act(async () => { await press(lastAlert()[2], 'Continue'); });
  expect(mockFindBackup).toHaveBeenCalledWith('seed words', 'mutinynet');
  expect(mockSave).toHaveBeenCalledWith('seed words', 'mutinynet');
});

test('a cloud backup found on Connect is restored only with consent', async () => {
  mockFindBackup.mockResolvedValue({ createdAt: Date.UTC(2026, 0, 2) });
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Connect'));
  await act(async () => { await press(lastAlert()[2], 'Continue'); });
  const [title, , buttons] = lastAlert();
  expect(title).toBe('Cloud backup found');
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Start empty', 'Restore']);
  expect(mockSave).not.toHaveBeenCalled();
  await act(async () => { await press(buttons, 'Restore'); });
  // The choice is saved (refusing a locked network) before restoring; ready only once the data is here.
  expect(mockCalls).toEqual(['save:mainnet', 'restore-cloud', 'ready', 'reconcile']);
  expect(mockReconcile).toHaveBeenCalledWith({ skipCloudRestore: true });
});

test('starting empty over a cloud backup asks twice', async () => {
  mockFindBackup.mockResolvedValue({ createdAt: 1 });
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Connect'));
  await act(async () => { await press(lastAlert()[2], 'Continue'); });
  await act(async () => { press(lastAlert()[2], 'Start empty'); });
  expect(lastAlert()[0]).toBe('Start without the backup?');
  await act(async () => { await press(lastAlert()[2], 'Start empty'); });
  expect(mockCalls).toEqual(['save:mainnet', 'reconcile']);
});

test('Restore from cloud with no backup says so and changes nothing', async () => {
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByText('Restore from cloud')); });
  expect(lastAlert()[0]).toBe('No cloud backup');
  expect(mockSave).not.toHaveBeenCalled();
});

test('a backup check that fails never starts an empty wallet', async () => {
  mockFindBackup.mockRejectedValue(new Error('Backup server error (503).'));
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Connect'));
  await act(async () => { await press(lastAlert()[2], 'Continue'); });
  expect(screen.getByText(/Couldn’t check for a cloud backup \(Backup server error \(503\)\.\)/)).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockReconcile).not.toHaveBeenCalled();
});

test('a start that fails, or reports nothing, shows the error and leaves it off', async () => {
  mockReconcile.mockResolvedValueOnce({ success: false, error: 'Indexer unreachable' });
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Connect'));
  await act(async () => { await press(lastAlert()[2], 'Continue'); });
  expect(screen.getByText('Indexer unreachable')).toBeTruthy();
  expect(mockCalls).toEqual(['save:mainnet', 'reconcile', 'save:null']);
  mockCalls.length = 0;
  mockReconcile.mockResolvedValueOnce(undefined);
  fireEvent.press(screen.getByText('Connect'));
  await act(async () => { await press(lastAlert()[2], 'Continue'); });
  expect(screen.getByText('RGB on this phone didn’t start. Try again.')).toBeTruthy();
  expect(mockCalls).toEqual(['save:mainnet', 'reconcile', 'save:null']);
});

test('RGB data can be restored from an exported file before it starts', async () => {
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByText('Restore from a backup file')); });
  const [title, , buttons] = lastAlert();
  expect(title).toBe('Restore RGB data?');
  await act(async () => { await press(buttons, 'Restore'); });
  expect(mockRestoreFile).toHaveBeenCalledWith(expect.objectContaining({ mnemonic: 'seed words', path: '/cache/my.rgbbackup' }));
  // Saved first (it refuses another network's data), then marked ready: no cloud restore over it on start.
  expect(mockCalls).toEqual(['save:mainnet', 'restore-file', 'ready', 'reconcile']);
});

test('once started, the network is fixed and restore is not offered', async () => {
  mockNetwork = null;
  mockPinned = 'mutinynet';
  mockLocked = 'mutinynet';
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  expect(screen.getByText(/Mutinynet · fixed for this wallet/)).toBeTruthy();
  expect(screen.queryByText('Mainnet')).toBeNull();
  expect(screen.queryByText('Restore from cloud')).toBeNull();
  expect(screen.queryByText('Restore from a backup file')).toBeNull();
  // Its data is here: connecting needs no questions.
  await act(async () => { fireEvent.press(screen.getByText('Connect')); });
  expect(mockFindBackup).not.toHaveBeenCalled();
  expect(mockCalls).toEqual(['save:mutinynet', 'reconcile']);
});

test('the indexer and proxy can be changed per wallet; saving reconnects', async () => {
  mockNetwork = 'mutinynet';
  mockPinned = 'mutinynet';
  mockLocked = 'mutinynet';
  mockAdapters.RGB_L1 = connectedL1();
  const screen = render(<RgbOnDeviceSettings walletId={7} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Servers'));
  expect(screen.getByLabelText('RGB indexer URL').props.value).toBe('https://default-indexer');
  fireEvent.changeText(screen.getByLabelText('RGB indexer URL'), 'https://my-esplora.example');
  await act(async () => { fireEvent.press(screen.getByText('Save and reconnect')); });
  expect(mockSaveEndpoints).toHaveBeenCalledWith('seed words', 'mutinynet', { indexerUrl: 'https://my-esplora.example', transportEndpoint: 'rpcs://default-proxy' });
  expect(mockReconcile).toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByText('Use defaults')); });
  expect(mockSaveEndpoints).toHaveBeenLastCalledWith('seed words', 'mutinynet', null);
});

test('while an RGB node is connected this wallet steps aside', async () => {
  const onOpenNode = jest.fn();
  const screen = render(<RgbOnDeviceSettings walletId={7} nodeActive onOpenNode={onOpenNode} />);
  await act(async () => {});
  expect(screen.getByText(/Your RGB Lightning Node is the RGB account/)).toBeTruthy();
  expect(screen.queryByText('Connect')).toBeNull();
  fireEvent.press(screen.getByText('Manage RGB node'));
  expect(onOpenNode).toHaveBeenCalled();
});

test('start errors read as plain words', () => {
  expect(rgbStartError('skipped: your RGB Lightning Node is the RGB account')).toMatch(/Remove it to use RGB on this phone/);
  expect(rgbStartError('skipped: something else')).toBe('something else');
  expect(rgbStartError(undefined)).toMatch(/didn’t start/);
});
