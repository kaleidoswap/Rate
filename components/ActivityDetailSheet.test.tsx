import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockCancel = jest.fn(async () => true);
jest.mock('../store/hooks', () => ({ useAppSelector: (f: any) => f({ settings: { bitcoinUnit: 'sats' } }) }));
jest.mock('../services/paymentProofs', () => ({ findPaymentProof: jest.fn(async () => null) }));
jest.mock('../services/TxAccelerationService', () => ({ accelerationTarget: () => null }));
jest.mock('./AccelerationPanel', () => ({ AccelerationPanel: () => null }));
jest.mock('../services/rgbWallet', () => ({ cancelRgbTransfer: (...args: any[]) => mockCancel(...(args as [])) }));
jest.mock('../services/protocols', () => ({
  rgbAccountAdapter: () => ({ protocolName: 'RGB_L1', isConnected: () => true, listTransfers: jest.fn(), account: { failTransfer: jest.fn() } }),
}));

import { ActivityDetailSheet } from './ActivityDetailSheet';
import type { ActivityItem } from '../services/ActivityService';

const item = (rgbTransfer: ActivityItem['rgbTransfer']): ActivityItem => ({
  id: 'transfer-x', type: 'receive', source: 'transfer', asset: 'rgb:a', assetName: 'Tether', assetTicker: 'USDT', assetPrecision: 6,
  amount: '5', status: 'pending', txid: '', layer: 'RGB-L1', network: 'signet', account: 'RGB', rgbTransfer,
});

test('a transfer waiting for the sender shows its progress and can be cancelled after confirming', async () => {
  const onRefresh = jest.fn(async () => true);
  const screen = render(<ActivityDetailSheet item={item({ status: 'waiting-counterparty', direction: 'incoming', batchTransferIdx: 7 })} onClose={jest.fn()} onRefresh={onRefresh} />);
  expect(screen.getByText('Waiting for the other side')).toBeTruthy();
  expect(screen.getByText(/Your invoice is open/)).toBeTruthy();
  fireEvent.press(screen.getByText('Cancel invoice'));
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
  await act(async () => { await buttons.find((b: any) => b.text === 'Cancel transfer').onPress(); });
  expect(mockCancel).toHaveBeenCalledWith(expect.anything(), 7);
  expect(onRefresh).toHaveBeenCalled();
  expect(screen.getByText('Cancelled.')).toBeTruthy();
});

test('a transfer already in a transaction can’t be cancelled', () => {
  const screen = render(<ActivityDetailSheet item={item({ status: 'waiting-confirmations', direction: 'incoming', batchTransferIdx: 7 })} onClose={jest.fn()} />);
  expect(screen.getByText('Waiting for confirmations')).toBeTruthy();
  expect(screen.queryByText('Cancel invoice')).toBeNull();
});
