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
jest.mock('../utils/feedback', () => ({ feedback: { select: jest.fn() } }));
jest.mock('./RgbOnDeviceSettings', () => ({
  RgbOnDeviceSettings: ({ nodeActive }: any) => { const { Text } = require('react-native'); return <Text>{nodeActive ? 'panel: node active' : 'panel: set up'}</Text>; },
}));

beforeEach(() => { mockNetwork = null; for (const k of Object.keys(mockAdapters)) delete mockAdapters[k]; });

test('with RGB on this phone in use, the header says so and its setup is shown', async () => {
  mockNetwork = 'mutinynet';
  mockAdapters.RGB_L1 = { isConnected: () => true };
  const onOpenNode = jest.fn();
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={onOpenNode} />);
  await act(async () => {});
  expect(screen.getByText('On this phone')).toBeTruthy();
  expect(screen.getByText('Mutinynet · beta')).toBeTruthy();
  expect(screen.getByLabelText('RGB status: Connected')).toBeTruthy();
  expect(screen.getByText('panel: set up')).toBeTruthy();
  // The node is the other choice: one tab away, then one tap.
  fireEvent.press(screen.getByLabelText('RGB node'));
  expect(screen.queryByText('panel: set up')).toBeNull();
  expect(screen.getByText('Not connected')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('RGB Lightning Node'));
  expect(onOpenNode).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Connect an RGB node'));
  expect(onOpenNode).toHaveBeenCalledTimes(2);
});

test('with nothing connected, the header says Not connected and mentions an idle phone setup', async () => {
  mockNetwork = 'mainnet';
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: false }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  expect(screen.getByText('RGB assets')).toBeTruthy();
  expect(screen.getByText(/set up for Mainnet but isn’t connected/)).toBeTruthy();
  expect(screen.getByLabelText('RGB status: Not connected')).toBeTruthy();
});

test('with an RGB node in use, it shows its name and network; this phone steps aside', async () => {
  mockNetwork = 'mainnet';
  const screen = render(<RgbAccountSettings walletId={7} node={{ connected: true, alias: 'My node', network: 'bitcoin' }} onOpenNode={jest.fn()} />);
  await act(async () => {});
  expect(screen.getByText('On your RGB node')).toBeTruthy();
  expect(screen.getAllByText('My node · Mainnet').length).toBe(2); // header and node row
  expect(screen.queryByText('Connect an RGB node')).toBeNull();
  expect(screen.queryByText(/panel:/)).toBeNull(); // the node tab is shown
  fireEvent.press(screen.getByLabelText('This phone'));
  expect(screen.getByText('panel: node active')).toBeTruthy();
});
