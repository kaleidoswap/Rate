import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RgbWalletTools } from './RgbWalletTools';

let mockLevel = 'advanced';
let mockAdapter: any = null;
jest.mock('../../store/hooks', () => ({
  useAppSelector: (f: any) => f({ settings: { disclosureLevel: mockLevel }, assets: { rgbAssets: [] } }),
  useAppDispatch: () => jest.fn(),
}));
jest.mock('../../services/protocols', () => ({ rgbAccountAdapter: () => mockAdapter }));
jest.mock('./RgbUtxoSheet', () => ({ RgbUtxoSheet: ({ visible }: any) => (visible ? require('react').createElement(require('react-native').Text, null, 'UTXO sheet open') : null) }));
const mockDeleteFailed = jest.fn(async () => true);
jest.mock('../../services/rgbWallet', () => ({ deleteFailedRgbTransfers: () => mockDeleteFailed() }));
jest.mock('./DrainSheet', () => ({ DrainSheet: ({ visible }: any) => (visible ? require('react').createElement(require('react-native').Text, null, 'Drain sheet open') : null) }));
jest.mock('../../store/slices/walletSlice', () => ({ loadBtcBalance: () => ({ type: 'loadBtcBalance' }) }));
jest.mock('./IssueAssetSheet', () => ({ IssueAssetSheet: ({ visible }: any) => (visible ? require('react').createElement(require('react-native').Text, null, 'Issue sheet open') : null) }));

const device = { protocolName: 'RGB_L1', isConnected: () => true, listUnspents: jest.fn(), createRgbUtxos: jest.fn(), issueAssetNia: jest.fn(), account: { issueAssetCfa: jest.fn() } };

beforeEach(() => { mockLevel = 'advanced'; mockAdapter = device; });

test('Advanced shows UTXOs and issuing for RGB on this phone, and opens each sheet', () => {
  const screen = render(<RgbWalletTools />);
  fireEvent.press(screen.getByLabelText('UTXOs'));
  expect(screen.getByText('UTXO sheet open')).toBeTruthy();
  expect(screen.getByText('A new token or collectible')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Issue an asset'));
  expect(screen.getByText('Issue sheet open')).toBeTruthy();
});

test('Lite shows neither', () => {
  mockLevel = 'lite';
  expect(render(<RgbWalletTools />).toJSON()).toBeNull();
});

test('the node over NWC shows only what its connection allows, and never issuing', () => {
  mockAdapter = { protocolName: 'RGB_LN', isConnected: () => true, walletType: () => 'rln', hasRlnMethod: (m: string) => m === 'rln_list_unspents' };
  const screen = render(<RgbWalletTools />);
  expect(screen.getByLabelText('UTXOs')).toBeTruthy();
  expect(screen.queryByLabelText('Issue an asset')).toBeNull();
  mockAdapter = { ...mockAdapter, hasRlnMethod: () => false };
  expect(render(<RgbWalletTools />).toJSON()).toBeNull();
});

test('sending all bitcoin is offered only where the native build can drain', () => {
  expect(render(<RgbWalletTools />).queryByLabelText('Send all bitcoin')).toBeNull();
  mockAdapter = { ...device, account: { ...device.account, capabilities: () => ({ drain: true }) } };
  const screen = render(<RgbWalletTools />);
  fireEvent.press(screen.getByLabelText('Send all bitcoin'));
  expect(screen.getByText('Drain sheet open')).toBeTruthy();
});

test('failed transfers can be cleared where the native build can, after confirming', async () => {
  expect(render(<RgbWalletTools />).queryByLabelText('Remove failed transfers')).toBeNull();
  mockAdapter = { ...device, account: { ...device.account, capabilities: () => ({ deleteTransfers: true }) } };
  const screen = render(<RgbWalletTools />);
  fireEvent.press(screen.getByLabelText('Remove failed transfers'));
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
  await act(async () => { await buttons.find((b: any) => b.text === 'Remove').onPress(); });
  expect(mockDeleteFailed).toHaveBeenCalled();
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)[0]).toBe('Removed');
});
