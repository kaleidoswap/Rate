import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RgbReceiveAdvanced, rgbAdvancedSummary } from './RgbReceiveAdvanced';
import { DEFAULT_RGB_RECEIVE_OPTIONS, rgbReceiveSupport } from '../../utils/rgb-receive';

const all = rgbReceiveSupport({ protocolName: 'RGB_L1', listUnspents: jest.fn(), createRgbUtxos: jest.fn() });
const nwc = rgbReceiveSupport({ walletType: () => 'rln' });

test('collapsed by default; opening it loads the UTXOs once', () => {
  const onLoad = jest.fn();
  const screen = render(<RgbReceiveAdvanced support={all} options={DEFAULT_RGB_RECEIVE_OPTIONS} onChange={jest.fn()}
    requestExpirySeconds={3600} utxos={null} onLoadUtxos={onLoad} onCreateUtxos={jest.fn()} />);
  expect(screen.queryByText('Invoice type')).toBeNull();
  fireEvent.press(screen.getByLabelText('Advanced RGB options: Default'));
  expect(screen.getByText('Invoice type')).toBeTruthy();
  expect(onLoad).toHaveBeenCalledTimes(1);
});

test('choosing blinded with no free UTXO warns and offers to create some', () => {
  const onChange = jest.fn();
  const onCreate = jest.fn();
  const screen = render(<RgbReceiveAdvanced support={all} options={{ ...DEFAULT_RGB_RECEIVE_OPTIONS, kind: 'blinded' }} onChange={onChange}
    requestExpirySeconds={3600} utxos={{ loading: false, list: [{ outpoint: 'aa:0', sats: 1000, colorable: true, allocations: 1, pending: 0 }] }}
    onLoadUtxos={jest.fn()} onCreateUtxos={onCreate} />);
  fireEvent.press(screen.getByLabelText('Advanced RGB options: Blinded'));
  expect(screen.getByText('No free UTXO to receive into. Create some below, or use Witness.')).toBeTruthy();
  expect(screen.getByText('0 free of 1 colorable UTXO')).toBeTruthy();
  fireEvent.press(screen.getByText('Create UTXOs'));
  expect(onCreate).toHaveBeenCalled();
  fireEvent.press(screen.getByText('1 day'));
  expect(onChange).toHaveBeenCalledWith({ kind: 'blinded', durationSeconds: 86_400, minConfirmations: 1 });
});

test('the node over NWC shows only expiry and confirmations', () => {
  const screen = render(<RgbReceiveAdvanced support={nwc} options={DEFAULT_RGB_RECEIVE_OPTIONS} onChange={jest.fn()}
    requestExpirySeconds={3600} utxos={null} onLoadUtxos={jest.fn()} />);
  fireEvent.press(screen.getByLabelText('Advanced RGB options: Default'));
  expect(screen.queryByText('Invoice type')).toBeNull();
  expect(screen.queryByText('UTXOs')).toBeNull();
  expect(screen.getByText('Expires in')).toBeTruthy();
  expect(screen.getByText('Confirmations')).toBeTruthy();
});

test('the summary lists only what differs from the default', () => {
  expect(rgbAdvancedSummary({ kind: 'blinded', durationSeconds: 604_800, minConfirmations: 3 }, all)).toBe('Blinded · 7 days · 3 confirmations');
  expect(rgbAdvancedSummary({ kind: 'blinded', durationSeconds: null, minConfirmations: 1 }, nwc)).toBe('Default');
});
