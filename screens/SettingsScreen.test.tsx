import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import SettingsScreen from './SettingsScreen';
const mockDispatch = jest.fn();
const mockState = { settings: { currency: 'USD', bitcoinUnit: 'sats', disclosureLevel: 'lite', soundEnabled: true }, nostr: { nwcConnections: [] }, wallet: { activeWallet: { id: 1, name: 'Daily wallet' }, isUnlocked: false } };
jest.mock('../store/hooks', () => ({ useAppSelector: (f: any) => f(mockState), useAppDispatch: () => mockDispatch }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (f: any) => require('react').useEffect(f, [f]) }));
jest.mock('../services/protocols/bark', () => ({ BARK_ENABLED: true }));
jest.mock('../services/protocols/barkPreferences', () => ({ currentBarkHost: () => ({ network: 'signet' }), loadBarkHost: async () => ({ network: 'signet' }), saveBarkNetwork: jest.fn() }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => null, disconnect: jest.fn() }, rgbAccountAdapter: () => null, rgbNodeConnected: () => false, reconcileRgbOnDevice: jest.fn(), initializeProtocols: jest.fn(async () => new Map([['BARK', { success: true }]])) }));
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getWalletNetworks: async () => [], getActiveWallet: async () => ({ id: 1, encrypted_mnemonic: 'public test fixture' }) }) } }));
jest.mock('../services/SecurityService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
jest.mock('../services/nwc/connectionStore', () => ({ removeNwcCredential: jest.fn() }));
jest.mock('../store/slices/walletSlice', () => ({ loadBtcBalance: jest.fn(), setActiveWallet: jest.fn() }));
jest.mock('../utils/feedback', () => ({ feedback: { success: jest.fn(), select: jest.fn() } }));
jest.mock('../utils/bitcoinUnits', () => ({ formatDenominatedAmount: () => ({ primary: '1,234,567', unitLabel: 'sats' }), useBitcoinPriceIn: () => 50000 }));
jest.mock('../components/RevealMnemonicModal', () => ({ RevealMnemonicModal: () => null }));
jest.mock('../components/OptionSheet', () => ({ OptionSheet: () => null }));
jest.mock('../components', () => ({
  MainHeader: ({ title, onBack }: any) => { const { Text, TouchableOpacity } = require('react-native'); return <TouchableOpacity accessibilityLabel="Back" onPress={onBack}><Text>{title}</Text></TouchableOpacity>; },
  Input: (props: any) => { const { TextInput } = require('react-native'); return <TextInput {...props} />; }, Button: () => null,
}));
const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); (require('react-native') as any).BackHandler = { addEventListener: () => ({ remove: jest.fn() }) }; (require('react-native') as any).Keyboard = { dismiss: jest.fn() }; });
test('home shows categories and keeps sensitive and technical actions in their sections', async () => {
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  expect(screen.queryByText('Daily wallet')).toBeNull();
  expect(screen.queryByText('Your wallet')).toBeNull();
  expect(screen.queryByText('Sats')).toBeNull();
  expect(screen.getByLabelText('KaleidoMind')).toBeTruthy();
  expect(screen.getByLabelText('Preferences')).toBeTruthy();
  expect(screen.queryByText('View recovery phrase')).toBeNull();
  expect(screen.queryByText('Remove Wallet')).toBeNull();
  fireEvent.press(screen.getByLabelText('Security & backup'));
  expect(screen.getByText('View recovery phrase')).toBeTruthy();
  expect(screen.getByText('Remove Wallet')).toBeTruthy();
  expect(screen.queryByText('Passkey unlock')).toBeNull();
  fireEvent.press(screen.getByLabelText('Back'));
  expect(screen.getByLabelText('Preferences')).toBeTruthy();
  expect(navigation.goBack).not.toHaveBeenCalled();
});
test('search finds advanced settings in lite mode and handles an empty result', async () => {
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Search settings'), 'bark');
  expect(screen.getByText('Bark')).toBeTruthy();
  expect(screen.queryByText('No settings found')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Search settings'), 'nonexistent');
  expect(screen.getByText('No settings found')).toBeTruthy();
});
test('preferences remain actionable and connections retain their destinations', async () => {
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Preferences'));
  fireEvent(screen.getByLabelText('Payment sounds'), 'valueChange', false);
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: false }));
  fireEvent.press(screen.getByLabelText('Back'));
  fireEvent.press(screen.getByLabelText('Connections'));
  fireEvent.press(screen.getByLabelText('Lightning wallet'));
  expect(navigation.navigate).toHaveBeenCalledWith('NWCConnect');
});

test('Bark’s network is changed from its account page, which describes real versus test bitcoin', async () => {
  const { Alert } = require('react-native');
  const alert = jest.spyOn(Alert, 'alert');
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Advanced'));
  fireEvent.press(screen.getByLabelText('Bark account settings'));
  fireEvent.press(screen.getByText('Change network'));
  expect(alert).toHaveBeenCalledWith('Bark network', expect.stringContaining('real bitcoin'), expect.arrayContaining([
    expect.objectContaining({ text: 'Mainnet', onPress: expect.any(Function) }),
    expect.objectContaining({ text: 'Signet (test bitcoin)  ✓', onPress: expect.any(Function) }),
  ]));
});

test('selecting Bark mainnet saves the preference and reconnects through protocol initialization', async () => {
  const { Alert } = require('react-native');
  const alert = jest.spyOn(Alert, 'alert');
  const { saveBarkNetwork } = require('../services/protocols/barkPreferences');
  const { protocolManager, initializeProtocols } = require('../services/protocols');
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Advanced'));
  fireEvent.press(screen.getByLabelText('Bark account settings'));
  fireEvent.press(screen.getByText('Change network'));
  const choices = alert.mock.calls[0][2];
  await act(async () => { choices.find((choice: any) => choice.text === 'Mainnet').onPress(); });
  expect(saveBarkNetwork).toHaveBeenCalledWith('public test fixture', 'mainnet');
  expect(protocolManager.disconnect).toHaveBeenCalledWith('BARK');
  expect(initializeProtocols).toHaveBeenCalledWith('public test fixture', []);
});

test('account pages expose supported controls and back returns to the account list', async () => {
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Advanced'));
  fireEvent.press(screen.getByLabelText('Spark account settings'));
  expect(screen.getByText('Reconnect account')).toBeTruthy();
  expect(screen.getByLabelText('Use this account')).toBeTruthy();
  expect(screen.queryByLabelText('Ark server URL')).toBeNull();
  fireEvent.press(screen.getByLabelText('Back'));
  fireEvent.press(screen.getByLabelText('Arkade account settings'));
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Ark server URL'), 'http://unsafe.example');
  fireEvent.press(screen.getByText('Save and reconnect'));
  expect(screen.getByText('Use an HTTPS URL without credentials, query parameters or a fragment.')).toBeTruthy();
  expect(require('../services/protocols').protocolManager.disconnect).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Back'));
  // RGB status reads the same as its hub: Not connected, never "Offline".
  expect(screen.getByLabelText('RGB account settings').props.accessibilityHint).toMatch(/^Not connected/);
  expect(screen.getByLabelText('Spark account settings').props.accessibilityHint).toMatch(/^Offline/);
  fireEvent.press(screen.getByLabelText('RGB account settings'));
  await act(async () => {});
  // RGB: choose RGB on this phone or a remote RGB Lightning Node; no "use this account" switch.
  expect(screen.queryByLabelText('Use this account')).toBeNull();
  expect(screen.queryByText('Change network')).toBeNull();
  expect(screen.getByLabelText('RGB status: Not connected')).toBeTruthy();
  expect(screen.getByLabelText('This phone')).toBeTruthy();
  // The node's how-to and connect live on their own screen.
  expect(screen.queryByText('How to connect')).toBeNull();
  fireEvent.press(screen.getByLabelText('RGB node'));
  fireEvent.press(screen.getByLabelText('RGB Lightning Node'));
  expect(navigation.navigate).toHaveBeenCalledWith('RgbNode');
});
