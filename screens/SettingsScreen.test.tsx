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
jest.mock('../components/OptionSheet', () => ({
  OptionSheet: ({ visible, title, options, onSelect }: any) => { const { Text } = require('react-native'); return visible ? options.map((o: any) => <Text key={o.id} onPress={() => onSelect(o.id)}>{`${title}: ${o.label}`}</Text>) : null; },
}));
jest.mock('../components', () => ({
  MainHeader: ({ title, onBack }: any) => { const { Text, TouchableOpacity } = require('react-native'); return <TouchableOpacity accessibilityLabel="Back" onPress={onBack}><Text>{title}</Text></TouchableOpacity>; },
  Input: (props: any) => { const { TextInput } = require('react-native'); return <TextInput {...props} />; }, Button: () => null,
}));
const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn() };
let mockSecurity: any;
const lockState = (over: Partial<{ pinEnabled: boolean; biometricEnabled: boolean; biometricType: string | null }>) => {
  mockSecurity = {
    getSecuritySettings: jest.fn(async () => ({ pinEnabled: false, biometricEnabled: false, biometricType: 'face', ...over })),
    authenticateWithBiometric: jest.fn(async () => true),
    setBiometricEnabled: jest.fn(async () => true),
  };
  require('../services/SecurityService').default.getInstance.mockReturnValue(mockSecurity);
};
beforeEach(() => { jest.clearAllMocks(); lockState({}); (require('react-native') as any).BackHandler = { addEventListener: () => ({ remove: jest.fn() }) }; (require('react-native') as any).Keyboard = { dismiss: jest.fn() }; });
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

const openSecurity = async () => {
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Security & backup'));
  await act(async () => {});
  return screen;
};

test('turning on Face ID needs a biometric check and is not saved when it fails', async () => {
  const screen = await openSecurity();
  expect(screen.getByText('App lock')).toBeTruthy();
  mockSecurity.authenticateWithBiometric.mockResolvedValueOnce(false);
  await act(async () => { fireEvent(screen.getByLabelText('Face ID'), 'valueChange', true); });
  expect(mockSecurity.authenticateWithBiometric).toHaveBeenCalledWith(expect.any(String), { allowDeviceFallback: false });
  expect(mockSecurity.setBiometricEnabled).not.toHaveBeenCalled();
  await act(async () => { fireEvent(screen.getByLabelText('Face ID'), 'valueChange', true); });
  expect(mockSecurity.setBiometricEnabled).toHaveBeenCalledWith(true);
});

test('without enrolled biometrics only a PIN is offered, and auto-lock waits for a lock', async () => {
  lockState({ biometricType: null });
  const screen = await openSecurity();
  expect(screen.queryByLabelText('Face ID')).toBeNull();
  expect(screen.queryByLabelText('Biometric unlock')).toBeNull();
  expect(screen.queryByLabelText('Auto-lock')).toBeNull();
  fireEvent.press(screen.getByLabelText('Set up PIN'));
  expect(navigation.navigate).toHaveBeenCalledWith('SecuritySetup', { mode: 'pin' });
});

test('with a PIN the user can change it, turn it off after confirming, and pick the auto-lock time', async () => {
  const { Alert } = require('react-native');
  lockState({ pinEnabled: true });
  const screen = await openSecurity();
  fireEvent.press(screen.getByLabelText('Change PIN'));
  expect(navigation.navigate).toHaveBeenCalledWith('SecuritySetup', { mode: 'pin' });
  fireEvent.press(screen.getByLabelText('Turn off PIN'));
  expect(Alert.alert).toHaveBeenLastCalledWith('Turn off PIN?', expect.stringContaining('turns off the app lock'), expect.any(Array));
  Alert.alert.mock.calls.at(-1)[2].find((b: any) => b.text === 'Turn off').onPress();
  expect(navigation.navigate).toHaveBeenCalledWith('SecuritySetup', { mode: 'disablePin' });
  fireEvent.press(screen.getByLabelText('Auto-lock'));
  fireEvent.press(screen.getByText('Auto-lock: After 15 minutes'));
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings/setAutoLockTimeout', payload: 15 }));
});

test('turning off the only lock asks first and needs the owner to authenticate', async () => {
  const { Alert } = require('react-native');
  lockState({ biometricEnabled: true });
  const screen = await openSecurity();
  await act(async () => { fireEvent(screen.getByLabelText('Face ID'), 'valueChange', false); });
  expect(mockSecurity.setBiometricEnabled).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Turn off app lock?', expect.any(String), expect.any(Array));
  mockSecurity.authenticateWithBiometric.mockResolvedValueOnce(false);
  await act(async () => { Alert.alert.mock.calls.at(-1)[2].find((b: any) => b.text === 'Turn off').onPress(); });
  expect(mockSecurity.setBiometricEnabled).not.toHaveBeenCalled();
  await act(async () => { Alert.alert.mock.calls.at(-1)[2].find((b: any) => b.text === 'Turn off').onPress(); });
  expect(mockSecurity.setBiometricEnabled).toHaveBeenCalledWith(false);
});

test('with a PIN, biometrics turn off without removing the lock', async () => {
  lockState({ pinEnabled: true, biometricEnabled: true, biometricType: 'fingerprint' });
  const screen = await openSecurity();
  await act(async () => { fireEvent(screen.getByLabelText('Touch ID'), 'valueChange', false); });
  expect(mockSecurity.authenticateWithBiometric).not.toHaveBeenCalled();
  expect(mockSecurity.setBiometricEnabled).toHaveBeenCalledWith(false);
});

test('search finds the app lock settings', async () => {
  const screen = render(<SettingsScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Search settings'), 'face id');
  expect(screen.getByText('App lock')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Search settings'), 'auto-lock');
  expect(screen.getByText('App lock')).toBeTruthy();
});
