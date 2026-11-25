import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import SwapScreen from './SwapScreen';
import swapReducer from '../store/slices/swapSlice';
import { BTC_ASSET_PUBKEY, USDB_TOKEN_ADDRESS } from '../utils/flashnet';

const mockDispatch = jest.fn();
const mockPairs = jest.fn();
const mockFlashnetPools = jest.fn();
const mockFlashnetQuote = jest.fn();
const mockExecuteSwap = jest.fn();
let mockUseFlashnet = false;
const mockFlashnetClient = { listPools: mockFlashnetPools, simulateSwap: mockFlashnetQuote, executeSwap: mockExecuteSwap };
const mockInventory = [{ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', balance: 1000, spendable: 1000, precision: 8, isNativeBtc: true, protocol: 'BTC' }];
const mockState = { swap: { ...swapReducer(undefined, { type: 'init' }), fromAsset: 'BTC', toAsset: 'TOK', fromAmount: '' }, settings: { bitcoinUnit: 'sats' }, wallet: { activeWallet: { id: 1 }, btcBalance: { byProtocol: { RGB: { total: 1000 } } } } };
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: (fn: any) => fn(mockState) }));
jest.mock('../hooks/usePolicy', () => ({ usePolicy: () => ({ showRouteSelector: false, showNetworks: true }) }));
jest.mock('../hooks/useAssetInventory', () => ({ useAssetInventory: () => mockInventory }));
jest.mock('../store/slices/assetsSlice', () => ({ syncAssets: jest.fn() }));
jest.mock('../utils/feedback', () => ({ feedback: { tap: jest.fn(), error: jest.fn(), swap: jest.fn() } }));
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: (p: string) => p === 'RGB_LN' ? { isConnected: (): boolean => true, listChannels: async () => [] as unknown[] }
    : p === 'SPARK' && mockUseFlashnet ? { isConnected: (): boolean => true } : null },
  kaleidoClientManager: { isInitialized: () => true, getClient: () => ({ maker: { listPairs: mockPairs } }) },
  flashnetClientManager: { isInitialized: () => mockUseFlashnet, getClient: () => mockFlashnetClient },
}));
jest.mock('../components/SlideToConfirm', () => ({
  SlideToConfirm: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => {
    const { Text, TouchableOpacity } = require('react-native');
    return <TouchableOpacity disabled={disabled} onPress={onConfirm}><Text>{label}</Text></TouchableOpacity>;
  },
}));
jest.mock('../components/mind/ExplainSheet', () => ({ ExplainButton: () => null }));
jest.mock('../components/payments/ProviderSheet', () => ({ ProviderSheet: () => null }));
jest.mock('../components/NetworkIcon', () => ({ NetworkIcon: () => null, networkIconForLabel: () => null }));
jest.mock('../components', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    Card: View, Input: View, MainHeader: () => null, AssetIcon: () => null, AssetSelector: () => null,
    PressableScale: TouchableOpacity,
    Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? <View>{children}</View> : null,
    AmountText: Text,
    Callout: ({ title, message }: any) => <View><Text>{title}</Text><Text>{message}</Text></View>,
    Button: ({ title, onPress, disabled }: any) => <TouchableOpacity disabled={disabled} onPress={onPress}><Text>{title}</Text></TouchableOpacity>,
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockUseFlashnet = false;
  mockDispatch.mockReset();
  mockState.swap = { ...swapReducer(undefined, { type: 'init' }), fromAsset: 'BTC', toAsset: 'TOK', fromAmount: '' };
  mockState.settings.bitcoinUnit = 'sats';
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

test.each([
  { accepted: true, reported: '2012345', display: '2.012345 USDB', stored: 2.012345, estimated: false },
  { accepted: true, reported: undefined, display: '≈ 2 USDB', stored: 2, estimated: true },
  { accepted: undefined, reported: '2012345', display: '≈ 2 USDB', stored: 2, estimated: true },
  { accepted: false, reported: '2012345', display: undefined, stored: 2, estimated: true },
])('records Flashnet execution or rejection (accepted: $accepted, output: $reported)', async ({ accepted, reported, display, stored, estimated }) => {
  jest.useFakeTimers();
  try {
    mockUseFlashnet = true;
    mockPairs.mockResolvedValue([]);
    mockFlashnetPools.mockResolvedValue([{
      lpPublicKey: 'flashnet-pool', assetAAddress: BTC_ASSET_PUBKEY, assetBAddress: USDB_TOKEN_ADDRESS.mainnet,
      assetAReserve: '100000', assetBReserve: '5000000',
    }]);
    mockFlashnetQuote.mockResolvedValue({ amountOut: '2000000', feePaidAssetIn: '5' });
    mockExecuteSwap.mockResolvedValue({ accepted, amountOut: reported, outboundTransferId: 'flashnet-transfer' });
    mockState.settings.bitcoinUnit = 'BTC';
    mockState.swap = { ...mockState.swap, toAsset: 'USDB', fromAmount: '0.00001' };
    mockDispatch.mockImplementation(action => { if (action?.type) mockState.swap = swapReducer(mockState.swap, action); });

    const view = render(<SwapScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(view.getByText('Review swap')).toBeTruthy());
    fireEvent.press(view.getByText('Review swap'));
    await act(async () => { fireEvent.press(view.getByText('Swap 2 USDB')); });

    expect(mockExecuteSwap).toHaveBeenCalledTimes(1);
    if (accepted === false) {
      expect(view.getByText('Swap rejected')).toBeTruthy();
      expect(view.queryByText('Swap complete')).toBeNull();
    } else {
      expect(view.getByText('Swap complete')).toBeTruthy();
      expect(view.getByText(`0.00001 BTC → ${display}`)).toBeTruthy();
    }
    expect(mockState.swap.swapHistory[0]).toMatchObject({
      from_asset: 'BTC', to_asset: 'USDB', from_amount: 1000, to_amount: stored,
      btc_amount_unit: 'sats', to_amount_estimated: estimated,
      txid: accepted === false ? undefined : 'flashnet-transfer', status: accepted === false ? 'failed' : 'completed',
    });
  } finally {
    jest.useRealTimers();
  }
});
