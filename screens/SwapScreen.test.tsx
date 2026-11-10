import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import SwapScreen from './SwapScreen';
import swapReducer from '../store/slices/swapSlice';

const mockDispatch = jest.fn();
const mockPairs = jest.fn();
const mockInventory = [{ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', balance: 1000, spendable: 1000, precision: 8, isNativeBtc: true, protocol: 'BTC' }];
const mockState = { swap: { ...swapReducer(undefined, { type: 'init' }), fromAsset: 'BTC', toAsset: 'TOK', fromAmount: '' }, settings: { bitcoinUnit: 'sats' }, wallet: { activeWallet: { id: 1 }, btcBalance: { byProtocol: { RGB: { total: 1000 } } } } };
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: (fn: any) => fn(mockState) }));
jest.mock('../hooks/usePolicy', () => ({ usePolicy: () => ({ showRouteSelector: false, showNetworks: true }) }));
jest.mock('../hooks/useAssetInventory', () => ({ useAssetInventory: () => mockInventory }));
jest.mock('../store/slices/assetsSlice', () => ({ syncAssets: jest.fn() }));
jest.mock('../utils/feedback', () => ({ feedback: { tap: jest.fn(), error: jest.fn(), swap: jest.fn() } }));
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: (p: string) => p === 'RGB_LN' ? { isConnected: () => true, listChannels: async () => [] } : null },
  kaleidoClientManager: { isInitialized: () => true, getClient: () => ({ maker: { listPairs: mockPairs } }) },
  flashnetClientManager: { isInitialized: () => false },
}));
jest.mock('../components/mind/ExplainSheet', () => ({ ExplainButton: () => null }));
jest.mock('../components/payments/ProviderSheet', () => ({ ProviderSheet: () => null }));
jest.mock('../components/NetworkIcon', () => ({ NetworkIcon: () => null, networkIconForLabel: () => null }));
jest.mock('../components', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    Card: View, Input: View, MainHeader: () => null, AssetIcon: () => null, AssetSelector: () => null,
    PressableScale: TouchableOpacity, Sheet: () => null, AmountText: Text,
    Callout: ({ title, message }: any) => <View><Text>{title}</Text><Text>{message}</Text></View>,
    Button: ({ title, onPress, disabled }: any) => <TouchableOpacity disabled={disabled} onPress={onPress}><Text>{title}</Text></TouchableOpacity>,
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockPairs.mockResolvedValue([{ base: { ticker: 'BTC', name: 'Bitcoin', precision: 8, protocol_ids: { BTC: 'btc' } }, quote: { ticker: 'TOK', name: 'Token', precision: 0, protocol_ids: { RGB: 'rgb:tok' } }, routes: [{ from_layer: 'BTC_LN', to_layer: 'RGB_LN' }] }]);
});
test('MAX does not offer the wallet balance when Lightning capacity is zero', async () => {
  const view = render(<SwapScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  expect(mockPairs).toHaveBeenCalled();
  expect(view.queryByText('Loading swap prices…')).toBeNull();
  fireEvent.press(view.getByText('MAX'));
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'swap/setFromAmount', payload: '0' });
  expect(view.getByLabelText('Amount to swap in sats')).toBeTruthy();
});
test('explains an incompatible maker market endpoint rather than an unexplained empty market', async () => {
  mockPairs.mockRejectedValue({ response: { status: 404 } });
  const view = render(<SwapScreen navigation={{ navigate: jest.fn() }} />);
  await waitFor(() => expect(view.getByText('RGB swaps unavailable with this maker')).toBeTruthy());
});

test('accepts the decimal comma from a localized mobile keyboard without multiplying the amount', async () => {
  const view = render(<SwapScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  fireEvent.changeText(view.getByLabelText('Amount to swap in sats'), '1,5');
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'swap/setFromAmount', payload: '1.5' });
});
