import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import SwapScreen from './SwapScreen';
import swapReducer from '../store/slices/swapSlice';
import { BTC_ASSET_PUBKEY, USDB_TOKEN_ADDRESS } from '../utils/flashnet';

const mockDispatch = jest.fn();
const mockPairs = jest.fn();
const mockMakerQuote = jest.fn();
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
jest.mock('../hooks/useFiatRates', () => ({ useFiatRates: () => ({ usd: 50_000 }) }));
jest.mock('../store/slices/assetsSlice', () => ({ syncAssets: jest.fn() }));
jest.mock('../utils/feedback', () => ({ feedback: { tap: jest.fn(), error: jest.fn(), swap: jest.fn() } }));
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: (p: string) => p === 'RGB_LN' ? { isConnected: (): boolean => true, network: 'mainnet', listChannels: async () => [] as unknown[] }
    : p === 'SPARK' && mockUseFlashnet ? { isConnected: (): boolean => true, network: 'mainnet' } : null },
  kaleidoClientManager: { isInitialized: () => true, getClient: () => ({ maker: { listPairs: mockPairs, getQuote: mockMakerQuote } }) },
  flashnetClientManager: { isInitialized: () => mockUseFlashnet, getClient: () => mockFlashnetClient },
}));
jest.mock('../components/HoldToConfirm', () => ({
  HoldToConfirm: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => {
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

test('opens review on the first live quote without switching terms when a better pool replies', async () => {
  jest.useFakeTimers();
  mockUseFlashnet = true;
  mockPairs.mockResolvedValue([]);
  mockFlashnetPools.mockResolvedValue(['slow', 'fast'].map(lpPublicKey => ({
    lpPublicKey, assetAAddress: BTC_ASSET_PUBKEY, assetBAddress: USDB_TOKEN_ADDRESS.mainnet,
  })));
  type Simulation = { amountOut: string; feePaidAssetIn: string };
  let finishSlow!: (result: Simulation) => void;
  const slow = new Promise<Simulation>(resolve => { finishSlow = resolve; });
  mockFlashnetQuote.mockImplementation(({ poolId }) => poolId === 'slow' ? slow : Promise.resolve({ amountOut: '2000000', feePaidAssetIn: '5' }));
  mockExecuteSwap.mockResolvedValue({ accepted: true, amountOut: '2000000', outboundTransferId: 'transfer' });
  mockState.swap = { ...mockState.swap, toAsset: 'USDB', fromAmount: '1000' };
  mockDispatch.mockImplementation(action => { if (action?.type) mockState.swap = swapReducer(mockState.swap, action); });

  const view = render(<SwapScreen navigation={{ navigate: jest.fn() }} />);
  try {
    await waitFor(() => expect(view.getByText('Review swap')).toBeTruthy());
    expect(view.getByText('Checking more providers…')).toBeTruthy();
    expect(view.getByText('≈ $2.00')).toBeTruthy();
    fireEvent.press(view.getByText('Review swap'));

    await act(async () => { finishSlow({ amountOut: '3000000', feePaidAssetIn: '3' }); await slow; });
    expect(view.queryByText('Swap 3 USDB')).toBeNull();
    expect(view.getByText('Compare (2)')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('Swap 2 USDB')); });
    expect(mockExecuteSwap).toHaveBeenCalledWith(expect.objectContaining({ poolId: 'fast', amountIn: '1000', minAmountOut: '1900000' }));
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test('omits dollar value on an unpriced RGB asset even when the BTC price is available', async () => {
  jest.useFakeTimers();
  mockMakerQuote.mockImplementation(async request => ({
    rfq_id: 'rgb-quote', from_asset: request.from_asset, to_asset: { ...request.to_asset, amount: 20 },
    fee: { final_fee: 0, fee_asset_precision: 0 }, expires_at: Date.now() / 1000 + 30,
  }));
  mockState.swap = { ...mockState.swap, fromAmount: '1000' };
  mockDispatch.mockImplementation(action => { if (action?.type) mockState.swap = swapReducer(mockState.swap, action); });
  const view = render(<SwapScreen navigation={{ navigate: jest.fn() }} />);
  try {
    await waitFor(() => expect(view.getByText('Not enough channel liquidity')).toBeTruthy());
    expect(view.queryByText('≈ $20.00')).toBeNull();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test('does not let a previous amount publish a delayed quote', async () => {
  jest.useFakeTimers();
  mockUseFlashnet = true;
  mockPairs.mockResolvedValue([]);
  mockFlashnetPools.mockResolvedValue([{ lpPublicKey: 'pool', assetAAddress: BTC_ASSET_PUBKEY, assetBAddress: USDB_TOKEN_ADDRESS.mainnet }]);
  type Simulation = { amountOut: string; feePaidAssetIn: string };
  let finishOld!: (result: Simulation) => void;
  const oldQuote = new Promise<Simulation>(resolve => { finishOld = resolve; });
  mockFlashnetQuote.mockImplementation(({ amountIn }) => amountIn === '1000' ? oldQuote : Promise.resolve({ amountOut: '1000000', feePaidAssetIn: '2' }));
  mockState.swap = { ...mockState.swap, toAsset: 'USDB', fromAmount: '1000' };
  mockDispatch.mockImplementation(action => { if (action?.type) mockState.swap = swapReducer(mockState.swap, action); });
  const screen = <SwapScreen navigation={{ navigate: jest.fn() }} />;
  const view = render(screen);
  try {
    await waitFor(() => expect(mockFlashnetQuote).toHaveBeenCalledWith(expect.objectContaining({ amountIn: '1000' })));
    fireEvent.changeText(view.getByLabelText('Amount to swap in sats'), '500');
    view.rerender(React.cloneElement(screen));
    await waitFor(() => expect(view.getByText('≈ $1.00')).toBeTruthy());

    await act(async () => { finishOld({ amountOut: '2000000', feePaidAssetIn: '4' }); await oldQuote; });
    expect(view.queryByText('≈ $2.00')).toBeNull();
    fireEvent.press(view.getByText('Review swap'));
    expect(view.getByText('Swap 1 USDB')).toBeTruthy();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test.each([
  { accepted: true, reported: '2012345', display: '2.012345 USDB', stored: 2.012345, estimated: false, refund: false, status: 'completed' },
  { accepted: true, reported: undefined, display: '≈ 2 USDB', stored: 2, estimated: true, refund: false, status: 'completed' },
  { accepted: undefined, reported: '2012345', display: undefined, stored: 2, estimated: true, refund: false, status: 'pending' },
  { accepted: false, reported: '2012345', display: undefined, stored: 2, estimated: true, refund: false, status: 'pending' },
  { accepted: false, reported: undefined, display: undefined, stored: 2, estimated: true, refund: true, status: 'failed' },
])('records Flashnet result (accepted: $accepted, refund: $refund, output: $reported)', async ({ accepted, reported, display, stored, estimated, refund, status }) => {
  jest.useFakeTimers();
  try {
    mockUseFlashnet = true;
    mockPairs.mockResolvedValue([]);
    mockFlashnetPools.mockResolvedValue([{
      lpPublicKey: 'flashnet-pool', assetAAddress: BTC_ASSET_PUBKEY, assetBAddress: USDB_TOKEN_ADDRESS.mainnet,
      assetAReserve: '100000', assetBReserve: '5000000',
    }]);
    mockFlashnetQuote.mockResolvedValue({ amountOut: '2000000', feePaidAssetIn: '5' });
    mockExecuteSwap.mockResolvedValue({
      accepted, amountOut: reported, outboundTransferId: 'flashnet-transfer',
      ...(refund && { refundTransferId: 'flashnet-refund', refundedAmount: '1000', refundedAssetAddress: BTC_ASSET_PUBKEY }),
    });
    mockState.settings.bitcoinUnit = 'BTC';
    mockState.swap = { ...mockState.swap, toAsset: 'USDB', fromAmount: '0.00001' };
    mockDispatch.mockImplementation(action => { if (action?.type) mockState.swap = swapReducer(mockState.swap, action); });

    const view = render(<SwapScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(view.getByText('Review swap')).toBeTruthy());
    fireEvent.press(view.getByText('Review swap'));
    await act(async () => { fireEvent.press(view.getByText('Swap 2 USDB')); });

    expect(mockExecuteSwap).toHaveBeenCalledTimes(1);
    if (status === 'failed') {
      expect(view.getByText('Swap rejected')).toBeTruthy();
      expect(view.queryByText('Swap complete')).toBeNull();
    } else if (status === 'pending') {
      expect(view.getByText('Not confirmed yet')).toBeTruthy();
      expect(view.queryByText('Swap complete')).toBeNull();
      expect(view.queryByText('Try again')).toBeNull();
    } else {
      expect(view.getByText('Swap complete')).toBeTruthy();
      expect(view.getByText(`0.00001 BTC → ${display}`)).toBeTruthy();
    }
    expect(mockState.swap.swapHistory[0]).toMatchObject({
      from_asset: 'BTC', to_asset: 'USDB', from_amount: 1000, to_amount: stored,
      btc_amount_unit: 'sats', to_amount_estimated: estimated,
      txid: status === 'completed' ? 'flashnet-transfer' : undefined, status,
    });
  } finally {
    jest.useRealTimers();
  }
});
