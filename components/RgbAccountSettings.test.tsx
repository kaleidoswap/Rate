import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RgbAccountSettings } from './RgbAccountSettings';

const mockAdapters: Record<string, any> = {};
let mockNetwork: string | null = null;
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getActiveWallet: async () => ({ id: 7, encrypted_mnemonic: 'seed words' }) }) } }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: (p: string) => mockAdapters[p] } }));
jest.mock('../services/protocols/rgbL1', () => ({
  RGB_L1_ENABLED: true,
  RGB_L1_NETWORK_LABEL: { mainnet: 'Mainnet', mutinynet: 'Mutinynet' },
  loadRgbL1Network: async () => mockNetwork,
}));
jest.mock('./RgbOnDeviceSettings', () => ({
  RgbOnDeviceSettings: ({ nodeActive }: any) => { const { Text } = require('react-native'); return <Text>{nodeActive ? 'panel: node active' : 'panel: set up'}</Text>; },
}));

beforeEach(() => { mockNetwork = null; for (const k of Object.keys(mockAdapters)) delete mockAdapters[k]; });

test('with RGB on this phone in use, its setup is open and the node is one tap away', async () => {
  mockNetwork = 'mutinynet';
  mockAdapters.RGB_L1 = { isConnected: () => true };
  const onOpenNode = jest.fn();
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={onOpenNode} />);
  await act(async () => {});
  expect(screen.getByText('In use · Mutinynet')).toBeTruthy();
  expect(screen.getByText('panel: set up')).toBeTruthy();
  expect(screen.getByText('Not connected')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('RGB Lightning Node'));
  expect(onOpenNode).toHaveBeenCalled();
});

test('with an RGB node in use, it shows its name and network; this phone is not in use', async () => {
  mockNetwork = 'mainnet';
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: true, alias: 'My node', network: 'bitcoin' }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  expect(screen.getByText('My node · Mainnet')).toBeTruthy();
  expect(screen.getByText('In use')).toBeTruthy();
  expect(screen.getByText('Not in use')).toBeTruthy();
  expect(screen.queryByText(/panel:/)).toBeNull(); // collapsed until chosen
  fireEvent.press(screen.getByLabelText('RGB on this phone'));
  expect(screen.getByText('panel: node active')).toBeTruthy();
});
