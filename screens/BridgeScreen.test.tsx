import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import BridgeScreen from './BridgeScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (f: any) => require('react').useEffect(f, [f]) }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader' }));
jest.mock('../components/Sheet', () => ({ Sheet: () => null }));
jest.mock('../components/receive/ReceiveQr', () => ({
  ReceiveQr: ({ value }: any) => { const { Text } = require('react-native'); return <Text>{`qr:${value}`}</Text>; },
}));
jest.mock('../utils/feedback', () => ({ feedback: new Proxy({}, { get: () => () => {} }) }));
jest.mock('../services/ToastService', () => ({ __esModule: true, default: { getInstance: () => ({ success: jest.fn(), error: jest.fn() }) } }));

let mockSpark: any = null;
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => mockSpark } }));
jest.mock('../services/kaleidoPay/connect', () => ({ receiveAccountChain: () => 'mainnet' }));

const mockClient = {
  getRoutes: jest.fn(),
  getEstimate: jest.fn(),
  createQuote: jest.fn(),
  submitOrder: jest.fn(),
  getStatus: jest.fn(),
};
jest.mock('../services/orchestra/client', () => ({
  ...jest.requireActual('../services/orchestra/client'),
  isOrchestraConfigured: () => true,
  getRoutes: (...a: any[]) => mockClient.getRoutes(...a),
  getEstimate: (...a: any[]) => mockClient.getEstimate(...a),
  createQuote: (...a: any[]) => mockClient.createQuote(...a),
  submitOrder: (...a: any[]) => mockClient.submitOrder(...a),
  getStatus: (...a: any[]) => mockClient.getStatus(...a),
}));

const ROUTE = {
  sourceChain: 'ethereum', sourceAsset: 'USDT', destinationChain: 'spark', destinationAsset: 'BTC',
  source: { chain: 'ethereum', asset: 'USDT', decimals: 6 }, destination: { chain: 'spark', asset: 'BTC', decimals: 8 },
};
const DEPOSIT = '0x52908400098527886e0f7030069857d2e4169ee7';

beforeEach(async () => {
  jest.clearAllMocks();
  await require('@react-native-async-storage/async-storage').clear();
  mockSpark = { isConnected: () => true, getReceiveAddress: jest.fn(async () => ({ address: 'spark1me' })) };
  mockClient.getRoutes.mockResolvedValue([ROUTE]);
  mockClient.getEstimate.mockResolvedValue({ estimatedOut: '15000', feeAmount: '20000', totalFeeAmount: '20000', feeBps: 20, feeAsset: 'USDT', route: ['USDT', 'BTC'] });
  mockClient.createQuote.mockResolvedValue({
    quoteId: 'q1', depositAddress: DEPOSIT, amountIn: '10000000', estimatedOut: '14900', feeAmount: '30000', totalFeeAmount: '30000',
    feeBps: 30, feeAsset: 'USDT', route: ['USDT', 'BTC'], expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  mockClient.submitOrder.mockRejectedValue(new Error('Orchestra POST /submit failed (400): {"message":"txHash is required"}'));
});

const open = () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  return { navigation, screen: render(<BridgeScreen navigation={navigation} />) };
};

test('explains that the bridge delivers to Spark when Spark is off', async () => {
  mockSpark = null;
  const { screen, navigation } = open();
  await act(async () => {});
  expect(screen.getByText('Needs your Spark account')).toBeTruthy();
  fireEvent.press(screen.getByText('Back'));
  expect(navigation.goBack).toHaveBeenCalled();
});

test('estimates, creates a quote to the Spark address and tracks the order to delivery', async () => {
  const { screen } = open();
  await act(async () => {});
  expect(screen.getByLabelText('From network: Ethereum')).toBeTruthy();

  fireEvent.changeText(screen.getByPlaceholderText('0.00'), '10');
  await waitFor(() => expect(screen.getByText('~15,000 sats')).toBeTruthy());
  expect(mockClient.getEstimate).toHaveBeenCalledWith(expect.objectContaining({ amount: '10000000', destinationAsset: 'BTC' }));

  await act(async () => { fireEvent.press(screen.getByText('Get deposit address')); });
  expect(mockClient.createQuote).toHaveBeenCalledWith(expect.objectContaining({
    sourceChain: 'ethereum', sourceAsset: 'USDT', destinationChain: 'spark', amount: '10000000', recipientAddress: 'spark1me',
  }));
  expect(screen.getByText('qr:0x52908400098527886E0F7030069857D2E4169EE7')).toBeTruthy();
  expect(screen.getByText('Send only USDT on Ethereum')).toBeTruthy();
  expect(screen.getByText('Waiting for your deposit…')).toBeTruthy();
  await waitFor(() => expect(mockClient.submitOrder).toHaveBeenCalledWith({ quoteId: 'q1' }));

  // The deposit is seen once a pasted hash is accepted.
  mockClient.submitOrder.mockResolvedValue({ orderId: 'order-1', status: 'processing', readToken: 'rt' });
  mockClient.getStatus.mockResolvedValue({ id: 'order-1', quoteId: 'q1', status: 'completed', amountOut: '14900' });
  fireEvent.changeText(screen.getByLabelText('Transaction hash'), '0xabc');
  await act(async () => { fireEvent.press(screen.getByText('Submit')); });

  await waitFor(() => expect(screen.getByText('Deposit complete')).toBeTruthy());
  expect(mockClient.getStatus).toHaveBeenCalledWith({ id: 'order-1', readToken: 'rt' });
  expect(screen.getByText('14,900 sats')).toBeTruthy();
});

test('resumes a saved deposit instead of starting over', async () => {
  const { screen } = open();
  await act(async () => {});
  fireEvent.changeText(screen.getByPlaceholderText('0.00'), '10');
  await act(async () => { fireEvent.press(screen.getByText('Get deposit address')); });
  expect(screen.getByText('Send only USDT on Ethereum')).toBeTruthy();
  screen.unmount();

  const again = open().screen;
  await act(async () => {});
  expect(again.getByText('Picked up where you left off')).toBeTruthy();
  expect(again.getByText('qr:0x52908400098527886E0F7030069857D2E4169EE7')).toBeTruthy();
  expect(mockClient.createQuote).toHaveBeenCalledTimes(1);
});
