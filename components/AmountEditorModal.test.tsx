import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AmountEditorModal } from './AmountEditorModal';
beforeEach(() => {
  const rn = require('react-native');
  rn.KeyboardAvoidingView = 'KeyboardAvoidingView';
  rn.Keyboard = { dismiss: jest.fn() };
});
const props = () => ({ visible: true, onClose: jest.fn(), onConfirm: jest.fn(), initialSats: 1000, bitcoinUnit: 'sats' as const, rates: { usd: 60000 }, requestOptions: { expirySeconds: 3600, showCountdown: false } });
test('saves amount, expiry and countdown atomically only on confirmation', () => {
  const p = props(); const screen = render(<AmountEditorModal {...p} />);
  fireEvent.changeText(screen.getByLabelText('Requested amount'), '2500');
  fireEvent.press(screen.getByLabelText('Expire after 24 hours'));
  fireEvent(screen.getByLabelText('Show expiry countdown'), 'valueChange', true);
  expect(p.onConfirm).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).toHaveBeenCalledWith(2500, { expirySeconds: 86400, showCountdown: true });
});
test('dismissing edits leaves the request unchanged and reopening restores its values', () => {
  const p = props(); const screen = render(<AmountEditorModal {...p} />);
  fireEvent.press(screen.getByLabelText('Expire after 10 min'));
  fireEvent.press(screen.getByText('Clear amount'));
  fireEvent.press(screen.getAllByLabelText('Close')[0]);
  expect(p.onConfirm).not.toHaveBeenCalled();
  screen.rerender(<AmountEditorModal {...p} visible={false} />);
  screen.rerender(<AmountEditorModal {...p} />);
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).toHaveBeenCalledWith(1000, p.requestOptions);
});
test('BTC entry preserves satoshi precision and invalid input cannot be saved', () => {
  const p = props(); const screen = render(<AmountEditorModal {...p} bitcoinUnit="BTC" />);
  fireEvent.changeText(screen.getByLabelText('Requested amount'), '0.00000001');
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).toHaveBeenCalledWith(1, p.requestOptions);
  p.onConfirm.mockClear();
  fireEvent.changeText(screen.getByLabelText('Requested amount'), '-3');
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).not.toHaveBeenCalled();
});
test('sending: an amount is required and there is no "any amount"', () => {
  const p = { ...props(), initialSats: undefined, requestOptions: undefined };
  const screen = render(<AmountEditorModal {...p} />);
  expect(screen.getByText('Amount to send')).toBeTruthy();
  expect(screen.queryByText('Clear amount')).toBeNull();
  fireEvent.press(screen.getByText('Set amount'));
  expect(p.onConfirm).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Requested amount'), '2100');
  fireEvent.press(screen.getByText('Set amount'));
  expect(p.onConfirm).toHaveBeenCalledWith(2100, undefined);
});
