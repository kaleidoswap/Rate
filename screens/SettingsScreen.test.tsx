import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import SettingsScreen from './SettingsScreen';
const mockDispatch = jest.fn();
const mockState = { settings: { currency: 'USD', bitcoinUnit: 'sats', disclosureLevel: 'lite', soundEnabled: true }, nostr: { nwcConnections: [] }, wallet: { activeWallet: { id: 1, name: 'Daily wallet' }, isUnlocked: false } };
jest.mock('../store/hooks', () => ({ useAppSelector: (f: any) => f(mockState), useAppDispatch: () => mockDispatch }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (f: any) => require('react').useEffect(f, [f]) }));
jest.mock('../services/protocols/bark', () => ({ BARK_ENABLED: true }));
jest.mock('../services/BarkService', () => ({ barkNetworkLabel: () => 'Signet' }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => null } }));
jest.mock('../services/PairingService', () => ({ PairingService: { getActive: async () => null } }));
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getWalletNetworks: async () => [] }) } }));
jest.mock('../services/SecurityService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
jest.mock('../services/nwc/connectionStore', () => ({ removeNwcCredential: jest.fn() }));
jest.mock('../store/slices/walletSlice', () => ({ loadBtcBalance: jest.fn(), setActiveWallet: jest.fn() }));
jest.mock('../utils/feedback', () => ({ feedback: { success: jest.fn() } }));
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
  expect(screen.getByText('Daily wallet')).toBeTruthy();
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
  fireEvent.press(screen.getByLabelText('Lightning node'));
  expect(navigation.navigate).toHaveBeenCalledWith('NWCConnect');
});
