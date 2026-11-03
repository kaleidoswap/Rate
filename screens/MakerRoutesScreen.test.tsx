jest.mock('./SendScreen', () => () => null);
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import MakerRoutesScreen from './MakerRoutesScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadMakerCatalog } from '../services/makerRoutes';
import { createArkadeLightningReceive, claimArkadeLightningReceive } from '../services/kaleidoPay/arkadeIntents';
let mockConnected = true;
const mockOptions = { network: 'mutinynet', makerUrl: 'https://maker.signet.kaleidoswap.com', wallet: {}, arkServerUrl: 'https://ark.test' };
jest.mock('../store/hooks', () => ({ useAppSelector: (fn: any) => fn({ wallet: { activeWallet: { id: 19 } } }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../components/receive/ReceiveRequestActions', () => ({ ReceiveRequestActions: () => require('react').createElement(require('react-native').Text, { testID: 'payment-request-controls' }, 'Copy request') }));
jest.mock('../services/kaleidoPay/connect', () => ({ arkadeReceiveOptions: () => mockConnected ? mockOptions : undefined, receiveAccountChain: () => 'mutinynet', kaleidoswapMakerUrl: () => mockOptions.makerUrl }));
jest.mock('../services/kaleidoPay/arkadeIntents', () => ({ ...jest.requireActual('../services/kaleidoPay/arkadeIntents'), createArkadeLightningReceive: jest.fn(), claimArkadeLightningReceive: jest.fn() }));
jest.mock('../services/makerRoutes', () => ({ ...jest.requireActual('../services/makerRoutes'), loadMakerCatalog: jest.fn() }));
const entry = { id: 'reverse:BTC:ARKD', kind: 'reverse', from: 'Lightning', to: 'Arkade', pairId: 'p', min: 10000, max: 100000, feePercent: 0.5, action: 'receive-arkade' };
const catalog = { url: mockOptions.makerUrl, network: 'mutinynet', checkedAt: 1, halted: false, routes: [entry] };
const receipt = { rfqId: 'rfq1', invoice: 'ln-test', amountSats: 10000, payAmountSats: 10100, provider: 'KaleidoSwap', expiresAt: 2000000000 };
beforeEach(async () => {
  jest.clearAllMocks(); mockConnected = true; await AsyncStorage.clear();
  (loadMakerCatalog as jest.Mock).mockResolvedValue(catalog);
  (createArkadeLightningReceive as jest.Mock).mockResolvedValue(receipt);
  (claimArkadeLightningReceive as jest.Mock).mockResolvedValue('prepared');
});
test('catalogue and route selection do not open a swap; generating uses the pinned provider and saves recovery UI', async () => {
  const v = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  fireEvent.press(v.getByText('Receive into Arkade'));
  expect(createArkadeLightningReceive).not.toHaveBeenCalled();
  fireEvent.changeText(v.getByLabelText('Amount to receive in Arkade sats'), '10000');
  await act(async () => { fireEvent.press(v.getByText('Generate Lightning request')); fireEvent.press(v.getByText('Generate Lightning request')); });
  expect(createArkadeLightningReceive).toHaveBeenCalledTimes(1);
  expect(createArkadeLightningReceive).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'kaleidoswap' }), 10000);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(expect.stringContaining('rate-maker-receive:19:mutinynet'), JSON.stringify(receipt));
  v.unmount();
  const reopened = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  expect(reopened.getByText('Waiting for payment or confirmation')).toBeTruthy();
  expect(createArkadeLightningReceive).toHaveBeenCalledTimes(1);
});
test('a removed route cannot create an invoice from stale UI', async () => {
  const v = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />); await act(async () => {});
  fireEvent.press(v.getByText('Receive into Arkade'));
  fireEvent.changeText(v.getByLabelText('Amount to receive in Arkade sats'), '10000');
  (loadMakerCatalog as jest.Mock).mockResolvedValue({ ...catalog, routes: [] });
  await act(async () => { fireEvent.press(v.getByText('Generate Lightning request')); });
  expect(v.getByText('This route is no longer available.')).toBeTruthy();
  expect(createArkadeLightningReceive).not.toHaveBeenCalled();
});
test('send action pins both maker and wallet network', async () => {
  (loadMakerCatalog as jest.Mock).mockResolvedValue({ ...catalog, routes: [{ ...entry, action: 'send-arkade' }] });
  const navigate = jest.fn(); const v = render(<MakerRoutesScreen navigation={{ navigate }} />); await act(async () => {});
  fireEvent.press(v.getByText('Pay a Lightning invoice'));
  expect(navigate).toHaveBeenCalledWith('Send', { makerNetwork: 'mutinynet', makerUrl: mockOptions.makerUrl });
});

test('offline reopening retains the receipt and never offers a replacement payment', async () => {
  await AsyncStorage.setItem(`rate-maker-receive:19:mutinynet:${mockOptions.makerUrl}`, JSON.stringify({ ...receipt, expiresAt: 1 }));
  (claimArkadeLightningReceive as jest.Mock).mockRejectedValue(new Error('offline'));
  const v = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  expect(v.getByText('Connection interrupted · checking saved request')).toBeTruthy();
  expect(v.getByText('Payment window closed. Checking the existing swap; do not pay this invoice again.')).toBeTruthy();
  expect(v.queryByText('Generate Lightning request')).toBeNull();
  expect(v.queryByText('Done')).toBeNull();
  expect(createArkadeLightningReceive).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(`rate-maker-receive:19:mutinynet:${mockOptions.makerUrl}`)).not.toBeNull();
});

test('restored invoices cannot be shared before their current status is checked', async () => {
  await AsyncStorage.setItem(`rate-maker-receive:19:mutinynet:${mockOptions.makerUrl}`, JSON.stringify(receipt));
  let resolve!: (phase: string) => void;
  (claimArkadeLightningReceive as jest.Mock).mockReturnValue(new Promise(r => { resolve = r; }));
  const v = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  expect(v.getByText('Connection interrupted · checking saved request')).toBeTruthy();
  expect(v.queryByTestId('payment-request-controls')).toBeNull();
  await act(async () => { resolve('settled'); });
  expect(v.getByText('Received in Arkade')).toBeTruthy();
  expect(v.queryByTestId('payment-request-controls')).toBeNull();
  expect(createArkadeLightningReceive).not.toHaveBeenCalled();
});
test('offline wallets can inspect a saved request without exposing its invoice for payment', async () => {
  mockConnected = false;
  await AsyncStorage.setItem(`rate-maker-receive:19:mutinynet:${mockOptions.makerUrl}`, JSON.stringify(receipt));
  const v = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  expect(v.getByText('Saved request · reconnect to check status')).toBeTruthy();
  expect(v.queryByTestId('payment-request-controls')).toBeNull();
  expect(claimArkadeLightningReceive).not.toHaveBeenCalled();
  expect(createArkadeLightningReceive).not.toHaveBeenCalled();
});

test('saved receipt recovery never waits for a route catalogue request', async () => {
  await AsyncStorage.setItem(`rate-maker-receive:19:mutinynet:${mockOptions.makerUrl}`, JSON.stringify(receipt));
  (loadMakerCatalog as jest.Mock).mockRejectedValue(new Error('offline catalogue'));
  (claimArkadeLightningReceive as jest.Mock).mockResolvedValue('settled');
  const v = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />); await act(async () => {});
  expect(v.getByText('Received in Arkade')).toBeTruthy();
  expect(loadMakerCatalog).not.toHaveBeenCalled();
  expect(v.queryByLabelText('Loading maker')).toBeNull();
  await act(async () => { fireEvent.press(v.getByText('Done')); });
  expect(loadMakerCatalog).toHaveBeenCalledTimes(1);
});

test('browsing other routes preserves the existing request and cannot create another swap', async () => {
  const key = `rate-maker-receive:19:mutinynet:${mockOptions.makerUrl}`;
  await AsyncStorage.setItem(key, JSON.stringify(receipt));
  const v = render(<MakerRoutesScreen navigation={{ navigate: jest.fn() }} />); await act(async () => {});
  await act(async () => { fireEvent.press(v.getByText('Browse routes')); });
  expect(v.getByText('Saved request · View status')).toBeTruthy();
  expect(v.queryByText('Generate Lightning request')).toBeNull();
  fireEvent.press(v.getByText('View saved request'));
  expect(v.getByText('Waiting for payment or confirmation')).toBeTruthy();
  expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify(receipt));
  expect(createArkadeLightningReceive).not.toHaveBeenCalled();
});

test('unified Swap generates and restores a receive request without opening another screen', async () => {
  const market = { base_asset: { id: 'btc' }, quote_asset: { id: 'btc' }, quote_corridor: 'lightning', fee_bps: 50, min_base_amount: '10000', max_base_amount: '100000', min_quote_amount: '10000', max_quote_amount: '100000' };
  (loadMakerCatalog as jest.Mock).mockResolvedValue({ ...catalog, routes: [{ ...entry, fromAsset: 'BTC', toAsset: 'ARKD', intentsMarket: market }] });
  const navigate = jest.fn(); const v = render(<MakerRoutesScreen navigation={{ navigate }} unified />);await act(async () => {});
  fireEvent.press(v.getByLabelText('Reverse swap direction'));
  fireEvent.changeText(v.getByLabelText('Swap amount in sats'), '10000');
  expect(v.getByText('Estimated fee 51 sats')).toBeTruthy();
  expect(createArkadeLightningReceive).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(v.getByText('Review swap')); });
  expect(createArkadeLightningReceive).toHaveBeenCalledTimes(1);
  expect(v.getByText('You receive 10,000 sats · sender pays 10,100 sats')).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});
