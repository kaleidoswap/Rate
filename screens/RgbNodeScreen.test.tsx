import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import RgbNodeScreen from './RgbNodeScreen';

let mockNode = false;
let mockWallet = false;
const mockState: any = { nostr: { nwcConnections: [], selectedNwcConnectionId: null } };
jest.mock('../store/hooks', () => ({ useAppSelector: (f: any) => f(mockState) }));
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: () => ({ isConnected: () => mockWallet }) },
  rgbNodeConnected: () => mockNode,
}));
jest.mock('../components', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    MainHeader: ({ title }: any) => <Text>{title}</Text>,
    Badge: ({ label }: any) => <Text>{label}</Text>,
    Callout: ({ message }: any) => <Text>{message}</Text>,
    Button: ({ title, onPress }: any) => <TouchableOpacity accessibilityRole="button" onPress={onPress}><Text>{title}</Text></TouchableOpacity>,
  };
});
const navigation = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn() };

beforeEach(() => { jest.clearAllMocks(); mockNode = false; mockWallet = false; mockState.nostr = { nwcConnections: [], selectedNwcConnectionId: null }; });

test('without a node it explains how to connect one and opens the connection screen', async () => {
  const screen = render(<RgbNodeScreen navigation={navigation} />);
  await act(async () => {});
  expect(screen.getByText('Not connected')).toBeTruthy();
  expect(screen.getByText('How to connect')).toBeTruthy();
  fireEvent.press(screen.getByText('Connect node'));
  expect(navigation.navigate).toHaveBeenCalledWith('NWCConnect');
  fireEvent.press(screen.getByText('Scan QR code'));
  expect(navigation.navigate).toHaveBeenCalledWith('QRScanner');
});

test('a plain Lightning wallet is not taken for an RGB node', async () => {
  mockWallet = true;
  mockState.nostr = { nwcConnections: [{ id: 'a', alias: 'Alby', network: 'mainnet', type: 'ln' }], selectedNwcConnectionId: 'a' };
  const screen = render(<RgbNodeScreen navigation={navigation} />);
  await act(async () => {});
  expect(screen.getByText(/Alby is connected over NWC, but it isn’t an RGB node/)).toBeTruthy();
  expect(screen.getByText('How to connect')).toBeTruthy();
});

test('a connected node shows its name and network and is managed from the connection screen', async () => {
  mockNode = true;
  mockWallet = true;
  mockState.nostr = { nwcConnections: [{ id: 'n', alias: 'My RLN', network: 'signet', type: 'rln' }], selectedNwcConnectionId: 'n' };
  const screen = render(<RgbNodeScreen navigation={navigation} />);
  await act(async () => {});
  expect(screen.getByText('My RLN')).toBeTruthy();
  expect(screen.getByText('Connected over NWC · Mutinynet')).toBeTruthy();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.queryByText('How to connect')).toBeNull();
  fireEvent.press(screen.getByText('Manage connection'));
  expect(navigation.navigate).toHaveBeenCalledWith('NWCConnect');
});
