import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AmountEditorModal } from '../AmountEditorModal';
import { RgbReceiveAdvanced } from './RgbReceiveAdvanced';
import { DEFAULT_RGB_RECEIVE_OPTIONS, rgbReceiveSupport } from '../../utils/rgb-receive';

jest.mock('../../services/buildVariant', () => ({ BFA_TEST_BUILD: true }));

test('the BFA request editor upgrades the short expiry and offers 30 minutes', () => {
  const rn = require('react-native');
  rn.KeyboardAvoidingView = 'KeyboardAvoidingView';
  rn.Keyboard = { dismiss: jest.fn() };
  const onConfirm = jest.fn();
  const screen = render(<AmountEditorModal visible initialSats={1000} rates={{ usd: 60_000 }}
    requestOptions={{ expirySeconds: 600, showCountdown: false }} onClose={jest.fn()} onConfirm={onConfirm} />);

  expect(screen.queryByLabelText('Expire after 10 min')).toBeNull();
  expect(screen.getByLabelText('Expire after 30 min')).toBeTruthy();
  fireEvent.press(screen.getByText('Save request'));
  expect(onConfirm).toHaveBeenCalledWith(1000, { expirySeconds: 1800, showCountdown: false, note: '' });
});

test('the BFA advanced editor offers 30 minutes or longer', () => {
  const support = rgbReceiveSupport({ protocolName: 'RGB_L1' });
  const onChange = jest.fn();
  const screen = render(<RgbReceiveAdvanced support={support} options={DEFAULT_RGB_RECEIVE_OPTIONS} onChange={onChange}
    requestExpirySeconds={3600} utxos={null} onLoadUtxos={jest.fn()} />);

  fireEvent.press(screen.getByLabelText('Advanced RGB options: Default'));
  expect(screen.queryByText('10 min')).toBeNull();
  expect(screen.getByText('7 days')).toBeTruthy();
  fireEvent.press(screen.getByText('30 min'));
  expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_RGB_RECEIVE_OPTIONS, durationSeconds: 1800 });
});
