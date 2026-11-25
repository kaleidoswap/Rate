import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RgbInvoiceOptions } from './RgbInvoiceOptions';
import { DEFAULT_RGB_RECEIVE_OPTIONS, rgbReceiveSupport } from '../../utils/rgb-receive';

const all = rgbReceiveSupport({ protocolName: 'RGB_L1', listUnspents: jest.fn(), createRgbUtxos: jest.fn() });
const nwc = rgbReceiveSupport({ walletType: () => 'rln' });

test('summarizes terms before expanding and only loads slots when Private is selected', () => {
  const onLoad = jest.fn();
  const onChange = jest.fn();
  const screen = render(<RgbInvoiceOptions support={all} options={DEFAULT_RGB_RECEIVE_OPTIONS} onChange={onChange}
    requestExpirySeconds={3600} utxos={null} onLoadUtxos={onLoad} onCreateUtxos={jest.fn()} />);
  const toggle = screen.getByRole('button', { name: 'Invoice options, Standard, 1 hour, 1 confirmation', expanded: false });
  expect(screen.getByText('Standard · 1 hour · 1 confirmation')).toBeTruthy();
  expect(screen.queryByText('Invoice type')).toBeNull();
  fireEvent.press(toggle);
  expect(screen.getByRole('button', { name: /Invoice options/, expanded: true })).toBeTruthy();
  expect(screen.getByText('Invoice type')).toBeTruthy();
  expect(onLoad).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Private'));
  expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_RGB_RECEIVE_OPTIONS, kind: 'blinded' });
  expect(onLoad).toHaveBeenCalledTimes(1);
});

test('choosing blinded with no free UTXO warns and offers to create some', () => {
  const onChange = jest.fn();
  const onCreate = jest.fn();
  const screen = render(<RgbInvoiceOptions support={all} options={{ ...DEFAULT_RGB_RECEIVE_OPTIONS, kind: 'blinded' }} onChange={onChange}
    requestExpirySeconds={3600} utxos={{ loading: false, list: [{ outpoint: 'aa:0', sats: 1000, colorable: true, allocations: 1, pending: 0, assets: [] }] }}
    onLoadUtxos={jest.fn()} onCreateUtxos={onCreate} />);
  fireEvent.press(screen.getByRole('button', { name: /Invoice options/ }));
  expect(screen.getByText('No free receive slot. Create some below, or switch to Standard.')).toBeTruthy();
  expect(screen.getByText('0 free of 1 receive slot')).toBeTruthy();
  fireEvent.press(screen.getByText('Create receive slots'));
  expect(onCreate).toHaveBeenCalled();
  fireEvent.press(screen.getByText('1 day'));
  expect(onChange).toHaveBeenCalledWith({ kind: 'blinded', durationSeconds: 86_400, minConfirmations: 1 });
});

test('the node over NWC offers invoice kind, expiry and confirmations without local UTXOs', () => {
  const screen = render(<RgbInvoiceOptions support={nwc} options={DEFAULT_RGB_RECEIVE_OPTIONS} onChange={jest.fn()}
    requestExpirySeconds={3600} utxos={null} onLoadUtxos={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: /Invoice options/ }));
  expect(screen.getByText('Invoice type')).toBeTruthy();
  expect(screen.getByText('Standard')).toBeTruthy();
  expect(screen.getByText('Private')).toBeTruthy();
  expect(screen.queryByText('Receive slots')).toBeNull();
  expect(screen.getByText('Expires in')).toBeTruthy();
  expect(screen.getByText('10 min')).toBeTruthy();
  expect(screen.getByText('Confirmations')).toBeTruthy();
});

test('proxy v1 uses a 30 minute minimum in the inline picker', () => {
  const onChange = jest.fn();
  const options = { ...DEFAULT_RGB_RECEIVE_OPTIONS, durationSeconds: 600 };
  const screen = render(<RgbInvoiceOptions support={all} options={options} onChange={onChange}
    requestExpirySeconds={3600} proxyV1 utxos={null} onLoadUtxos={jest.fn()} />);
  expect(screen.getByText('Standard · 30 min · 1 confirmation')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: /Invoice options/ }));
  expect(screen.queryByLabelText('10 min')).toBeNull();
  expect(screen.getByLabelText('30 min').props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByLabelText('30 min'));
  expect(onChange).toHaveBeenCalledWith({ ...options, durationSeconds: 1800 });
});
