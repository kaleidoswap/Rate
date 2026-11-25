import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import type { RgbBackupStatus } from '../services/protocols/rgbBackup';
import { RgbAccountSettings } from './RgbAccountSettings';

jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ t: (text: string) => text }) }));
jest.mock('../store/hooks', () => ({ useAppSelector: (select: any) => select({ settings: { hideBalances: false } }) }));
jest.mock('./rgb/RgbWalletTools', () => ({
  RgbWalletTools: ({ onIssued }: { onIssued: () => void }) => {
    const { Text } = require('react-native');
    const [issued, setIssued] = require('react').useState(false);
    return <Text onPress={() => { setIssued(true); onIssued(); }}>{issued ? 'Asset issued' : 'Confirm issuance'}</Text>;
  },
}));
const mockAdapters: Record<string, any> = {};
let mockNetwork: string | null = null;
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getActiveWallet: async () => ({ id: 7, encrypted_mnemonic: 'seed words' }) }) } }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: (p: string) => mockAdapters[p] } }));
jest.mock('../services/protocols/rgbL1', () => ({
  ...jest.requireActual('../services/protocols/rgbL1'),
  RGB_L1_ENABLED: true,
  isRgbLibNativeAvailable: () => true,
  isRgbL1NetworkSwitchSupported: () => true,
  lockedRgbL1Network: async () => null,
  pinnedRgbL1Network: async () => null,
  readyRgbL1Networks: async () => [],
  loadRgbL1Host: async () => ({ indexerUrl: 'https://indexer.example', transportEndpoint: 'rpcs://proxy.example' }),
  installedRgbLibVersion: () => 'test-native-release',
  RGB_L1_NETWORK_LABEL: { mainnet: 'Mainnet', mutinynet: 'Mutinynet' },
  loadRgbL1Network: async () => mockNetwork,
}));
jest.mock('../utils/feedback', () => ({ feedback: { select: jest.fn() } }));
const mockRunBackup = jest.fn(async (_force: boolean) => undefined);
let mockBackupListener: ((status: RgbBackupStatus) => void) | undefined;
const mockFindBackup = jest.fn(async (_mnemonic: string, _network: string): Promise<{ createdAt: number } | null> => null);
jest.mock('../services/protocols/rgbBackup', () => ({
  rgbBackupStatus: () => ({ state: 'idle' }),
  onRgbBackupStatus: (listener: (status: RgbBackupStatus) => void) => {
    mockBackupListener = listener;
    return () => { mockBackupListener = undefined; };
  },
  runRgbBackup: (force: boolean) => mockRunBackup(force),
  findRgbCloudBackup: (mnemonic: string, network: string) => mockFindBackup(mnemonic, network),
}));

beforeEach(() => { jest.clearAllMocks(); mockNetwork = null; for (const k of Object.keys(mockAdapters)) delete mockAdapters[k]; });

test('keeps the wallet summary visible while one compact settings card is open at a time', async () => {
  mockNetwork = 'mutinynet';
  const listAssets = jest.fn(async () => []);
  mockAdapters.RGB_L1 = { isConnected: () => true, account: { backupRequired: async () => true }, listAssets };
  const onOpenNode = jest.fn();
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={onOpenNode} />);
  await act(async () => {});
  expect(screen.getByText('On this phone')).toBeTruthy();
  const summary = within(screen.getByTestId('rgb-account-summary'));
  expect(summary.getByText('Mutinynet')).toBeTruthy();
  expect(summary.getByText('Changed since the last backup · backs up automatically')).toBeTruthy();
  const sections = ['Backup & recovery', 'Assets & UTXOs', 'Advanced'];
  expect(screen.getAllByRole('button').map(button => button.props.accessibilityLabel)).toEqual(sections);
  sections.forEach(name => expect(screen.getByRole('button', { name, expanded: false })).toBeTruthy());
  expect(screen.getByLabelText('RGB status: Connected')).toBeTruthy();
  expect(screen.queryByText('Connected · Mutinynet')).toBeNull();
  expect(screen.queryByText('Export backup file')).toBeNull();
  expect(listAssets).not.toHaveBeenCalled();
  expect(screen.getAllByText('Backup')).toHaveLength(1);
  fireEvent.press(screen.getByRole('button', { name: 'Backup & recovery' }));
  expect(screen.getByText('Export backup file')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByLabelText('Back up RGB data now')); });
  expect(mockRunBackup).toHaveBeenCalledWith(true);
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Assets & UTXOs' })); });
  expect(listAssets).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Export backup file')).toBeNull();
  expect(screen.getByText('Wallet assets')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  expect(screen.getByText('Connected · Mutinynet')).toBeTruthy();
  expect(screen.queryByText('Wallet assets')).toBeNull();
  fireEvent.press(screen.getByLabelText('RGB node'));
  expect(screen.queryByText('Connected · Mutinynet')).toBeNull();
  fireEvent.press(screen.getByLabelText('Connect an RGB node'));
  expect(onOpenNode).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'Advanced', expanded: true }));
  sections.forEach(name => expect(screen.getByRole('button', { name, expanded: false })).toBeTruthy());
  expect(summary.getByText('Mutinynet')).toBeTruthy();
});

test('the summary follows an automatic upload with the backup controls closed', async () => {
  mockNetwork = 'mainnet';
  const backupRequired = jest.fn().mockResolvedValue(true);
  mockAdapters.RGB_L1 = { isConnected: () => true, account: { backupRequired }, listAssets: async () => [] };
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={jest.fn()} />);
  await screen.findByText('Changed since the last backup · backs up automatically');
  expect(mockRunBackup).not.toHaveBeenCalled();
  act(() => mockBackupListener?.({ state: 'backing-up' }));
  expect(screen.getByText('Backing up…')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Backup & recovery', expanded: false }));
  fireEvent.press(screen.getByLabelText('Back up RGB data now'));
  expect(mockRunBackup).not.toHaveBeenCalled();
  backupRequired.mockResolvedValue(false);
  await act(async () => mockBackupListener?.({ state: 'done', lastBackupAt: 1_000 }));
  expect(within(screen.getByTestId('rgb-account-summary')).getByText(/^Up to date ·/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByLabelText('Back up RGB data now')); });
  expect(mockRunBackup).toHaveBeenCalledTimes(1);
});

test('reads the existing cloud manifest for the active network when opening a connected wallet', async () => {
  mockNetwork = 'mainnet';
  mockAdapters.RGB_L1 = { isConnected: () => true, account: { backupRequired: async () => false }, listAssets: async () => [] };
  mockFindBackup.mockResolvedValueOnce({ createdAt: 1_700_000_000_000 });
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={jest.fn()} />);
  const summary = within(screen.getByTestId('rgb-account-summary'));
  expect(await summary.findByText(/^Last cloud backup ·/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.press(screen.getByLabelText('RGB node'));
  expect(mockFindBackup).toHaveBeenCalledTimes(1);
  expect(mockFindBackup).toHaveBeenCalledWith('seed words', 'mainnet');
  expect(mockRunBackup).not.toHaveBeenCalled();
});

test('with nothing connected, the header says Not connected and mentions an idle phone setup', async () => {
  mockNetwork = 'mainnet';
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  const summary = within(screen.getByTestId('rgb-account-summary'));
  expect(summary.getByText('This phone')).toBeTruthy();
  expect(summary.getByText('Mainnet')).toBeTruthy();
  expect(summary.getByText('Backup status unavailable offline')).toBeTruthy();
  expect(screen.getByLabelText('RGB status: Not connected')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Backup & recovery' }));
  expect(screen.getByText('Restore from a backup file')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.press(screen.getByText('Mutinynet'));
  fireEvent.press(screen.getByLabelText('RGB node'));
  fireEvent.press(screen.getByRole('button', { name: 'Backup & recovery' }));
  expect(screen.getByText('This wallet’s automatic backup on Mutinynet')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Restore from cloud')); });
  expect(mockFindBackup).toHaveBeenCalledWith('seed words', 'mutinynet');
  expect(screen.getByText(/There’s no RGB backup of this wallet on Mutinynet/)).toBeTruthy();
});

test('with an RGB node in use, it shows its name and network; this phone steps aside', async () => {
  mockNetwork = 'mainnet';
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: true, alias: 'My node', network: 'bitcoin' }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  expect(screen.getByText('On your RGB node')).toBeTruthy();
  expect(screen.getByText('My node · Mainnet')).toBeTruthy();
  expect(screen.getByText('Managed on the node')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  expect(screen.getByLabelText('Manage RGB node')).toBeTruthy();
  expect(screen.queryByText('Connect an RGB node')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Backup & recovery' }));
  expect(screen.getByText('Node backup')).toBeTruthy();
  expect(screen.queryByText('Cloud backup')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.press(screen.getByLabelText('This phone'));
  expect(screen.getByText(/Your RGB Lightning Node is the RGB account/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Backup & recovery' }));
  expect(screen.getByText('Node backup')).toBeTruthy();
  expect(screen.queryByText('Restore from cloud')).toBeNull();
});


test('validation follows the active wallet when previewing a connection and reads node details only on demand', async () => {
  mockNetwork = 'mutinynet';
  mockAdapters.RGB_LN = {
    isConnected: () => true,
    listAssets: async () => [],
    getNodeInfo: jest.fn(async () => ({ num_channels: 0, pubkey: 'node public key', max_media_upload_size_mb: 12, account_xpub_colored: 'private wallet data' })),
  };
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: true, network: 'signet', relays: ['wss://node.example/connection?key=fixture', 'invalid'] }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  expect(mockAdapters.RGB_LN.getNodeInfo).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  expect(mockAdapters.RGB_LN.getNodeInfo).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Client-side validation'));
  await act(async () => {});
  expect(screen.getByText('Configured on your node')).toBeTruthy();
  expect(screen.getByText('node.example')).toBeTruthy();
  expect(screen.getByText('12 MB')).toBeTruthy();
  expect(screen.getByText('0')).toBeTruthy();
  expect(screen.queryByText(/key=fixture|private wallet data/)).toBeNull();
  fireEvent.press(screen.getByLabelText('This phone'));
  expect(screen.getByText('node.example')).toBeTruthy();
  expect(screen.queryByText(/rgb-lib test-native-release/)).toBeNull();
  screen.rerender(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  expect(screen.queryByText('Wallet assets')).toBeNull();
  fireEvent.press(screen.getByLabelText('Client-side validation'));
  expect(screen.getByText('rgb-lib test-native-release')).toBeTruthy();
  expect(screen.getByText('NIA, CFA, UDA, IFA')).toBeTruthy();
  expect(screen.queryByText('node.example')).toBeNull();
});

test('successful issuance reloads the visible inventory and keeps the confirmation mounted', async () => {
  mockNetwork = 'mainnet';
  const listAssets = jest.fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: 'rgb:example', name: 'Example', ticker: 'EX', layer: 'RGB_L1', balance: { availableDisplay: '1' } }]);
  mockAdapters.RGB_L1 = { isConnected: () => true, account: { backupRequired: async () => false }, listAssets };
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={jest.fn()} />);
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Assets & UTXOs' })); });
  expect(await screen.findByText('No RGB assets in this wallet')).toBeTruthy();
  fireEvent.press(screen.getByText('Confirm issuance'));
  expect(await screen.findByText(/Example · EX/)).toBeTruthy();
  expect(screen.getByText('Asset issued')).toBeTruthy();
  expect(listAssets).toHaveBeenCalledTimes(2);
});

test('when on-device setup is held, a new wallet only offers the node and an existing device wallet stays accessible', async () => {
  const screen = render(<RgbAccountSettings walletId={7} allowNewPhoneSetup={false} node={{ connected: false }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  fireEvent.press(screen.getByRole('button', { name: 'Backup & recovery' }));
  expect(screen.getByText('Node backup')).toBeTruthy();
  expect(screen.queryByText('Restore from cloud')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  expect(screen.queryByLabelText('This phone')).toBeNull();
  expect(screen.getByLabelText('Connect an RGB node')).toBeTruthy();
  screen.unmount();
  mockNetwork = 'mainnet';
  const existing = render(<RgbAccountSettings walletId={7} allowNewPhoneSetup={false} node={{ connected: false }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  fireEvent.press(existing.getByRole('button', { name: 'Advanced' }));
  expect(existing.getByLabelText('This phone')).toBeTruthy();
  fireEvent.press(existing.getByRole('button', { name: 'Backup & recovery' }));
  expect(existing.getByText('Restore from a backup file')).toBeTruthy();
});

test('a build holding phone setup still shows a previously configured phone account', async () => {
  const props = { walletId: 7, node: { connected: false }, allowNewPhoneSetup: false, onOpenNode: jest.fn() };
  const screen = render(<RgbAccountSettings {...props} />);
  await act(async () => {});
  expect(screen.queryByLabelText('This phone')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  expect(screen.queryByLabelText('This phone')).toBeNull();
  expect(screen.getByText('Connect an RGB node')).toBeTruthy();

  screen.unmount();
  mockNetwork = 'mainnet';
  const configured = render(<RgbAccountSettings {...props} />);
  await act(async () => {});
  fireEvent.press(configured.getByRole('button', { name: 'Advanced' }));
  expect(configured.getByLabelText('This phone')).toBeTruthy();
  expect(configured.getByText(/On for Mainnet/)).toBeTruthy();
});
