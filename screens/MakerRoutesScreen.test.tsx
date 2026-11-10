jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import MakerRoutesScreen from './MakerRoutesScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadMakerCatalog } from '../services/makerRoutes';
import { createArkadeLightningReceive, claimArkadeLightningReceive } from '../services/kaleidoPay/arkadeIntents';
const mockOptions = { network: 'mutinynet', makerUrl: 'https://maker.signet.kaleidoswap.com', wallet: {}, arkServerUrl: 'https://ark.test' };
jest.mock('../store/hooks', () => ({ useAppSelector: (fn: any) => fn({ wallet: { activeWallet: { id: 19 } } }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../components/receive/ReceiveRequestActions', () => ({ ReceiveRequestActions: () => null }));
jest.mock('../services/kaleidoPay/connect', () => ({ arkadeReceiveOptions: () => mockOptions, receiveAccountChain: () => 'mutinynet', kaleidoswapMakerUrl: () => mockOptions.makerUrl }));
jest.mock('../services/kaleidoPay/arkadeIntents', () => ({ createArkadeLightningReceive: jest.fn(), claimArkadeLightningReceive: jest.fn() }));
jest.mock('../services/makerRoutes', () => ({ ...jest.requireActual('../services/makerRoutes'), loadMakerCatalog: jest.fn() }));
const entry = { id: 'reverse:BTC:ARKD', kind: 'reverse', from: 'Lightning', to: 'Arkade', pairId: 'p', min: 10000, max: 100000, feePercent: 0.5, action: 'receive-arkade' };
const catalog = { url: mockOptions.makerUrl, network: 'mutinynet', checkedAt: 1, halted: false, routes: [entry] };
const receipt = { rfqId: 'rfq1', invoice: 'ln-test', amountSats: 10000, payAmountSats: 10100, provider: 'KaleidoSwap', expiresAt: 2000000000 };
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
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
