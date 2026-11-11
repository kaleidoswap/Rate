import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AmountEditorModal } from './AmountEditorModal';
import { composeAmountKey, groupComposedAmount } from './AmountPad';
beforeEach(() => {
  const rn = require('react-native');
  rn.KeyboardAvoidingView = 'KeyboardAvoidingView';
  rn.Keyboard = { dismiss: jest.fn() };
});
const props = () => ({ visible: true, onClose: jest.fn(), onConfirm: jest.fn(), initialSats: 1000, bitcoinUnit: 'sats' as const, rates: { usd: 60000 }, requestOptions: { expirySeconds: 3600, showCountdown: false } });
const KEY_LABELS: Record<string, string> = { '.': 'Decimal point', back: 'Backspace' };
const type = (screen: any, keys: string[]) => { for (const k of keys) fireEvent.press(screen.getByLabelText(KEY_LABELS[k] ?? k)); };

test('the keypad composes plain decimals and never a second point or extra decimals', () => {
  expect(composeAmountKey('', '2', 2)).toBe('2');
  expect(composeAmountKey('2', '5', 2)).toBe('25');
  expect(composeAmountKey('25', '.', 2)).toBe('25.');
  expect(composeAmountKey('25.', '5', 2)).toBe('25.5');
  expect(composeAmountKey('25.5', '.', 2)).toBe('25.5'); // one point only
  expect(composeAmountKey('25.5', '9', 2)).toBe('25.59'); // two decimals fit
  expect(composeAmountKey('25.59', '9', 2)).toBe('25.59'); // decimals capped
  expect(composeAmountKey('25', '9', 0)).toBe('259'); // sats still take digits
  expect(composeAmountKey('25.59', 'back', 2)).toBe('25.5');
  expect(composeAmountKey('0', '7', 2)).toBe('7'); // leading zero replaced
  expect(composeAmountKey('', '.', 2)).toBe('0.');
  expect(composeAmountKey('3', '.', 0)).toBe('3'); // sats never get a point
  expect(groupComposedAmount('1234567.89')).toBe('1,234,567.89');
});

test('saves amount, expiry and countdown atomically only on confirmation', () => {
  const p = { ...props(), initialSats: undefined }; const screen = render(<AmountEditorModal {...p} />);
  type(screen, ['2', '5', '0', '0']);
  fireEvent.press(screen.getByLabelText('Expire after 24 hours'));
  fireEvent(screen.getByLabelText('Show expiry countdown'), 'valueChange', true);
  expect(p.onConfirm).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).toHaveBeenCalledWith(2500, { expirySeconds: 86400, showCountdown: true, note: '' });
});
test('dismissing edits leaves the request unchanged and reopening restores its values', () => {
  const p = props(); const screen = render(<AmountEditorModal {...p} />);
  fireEvent.press(screen.getByLabelText('Expire after 10 min'));
  fireEvent.press(screen.getByLabelText('Any amount: the sender decides'));
  fireEvent.changeText(screen.getByLabelText('Request note'), 'Pizza');
  fireEvent.press(screen.getAllByLabelText('Close')[0]);
  expect(p.onConfirm).not.toHaveBeenCalled();
  screen.rerender(<AmountEditorModal {...p} visible={false} />);
  screen.rerender(<AmountEditorModal {...p} />);
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).toHaveBeenCalledWith(1000, { ...p.requestOptions, note: '' });
});
test('BTC entry preserves satoshi precision', () => {
  const p = { ...props(), initialSats: undefined, bitcoinUnit: 'BTC' as const }; const screen = render(<AmountEditorModal {...p} />);
  type(screen, ['0', '.', '0', '0', '0', '0', '0', '0', '0', '1']);
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).toHaveBeenCalledWith(1, { ...p.requestOptions, note: '' });
});
test('sending: an amount is required and there is no "any amount"', () => {
  const p = { ...props(), initialSats: undefined, requestOptions: undefined };
  const screen = render(<AmountEditorModal {...p} />);
  expect(screen.getByText('Amount to send')).toBeTruthy();
  expect(screen.queryByText('Any amount')).toBeNull();
  expect(screen.queryByLabelText('Request note')).toBeNull();
  fireEvent.press(screen.getByText('Set amount'));
  expect(p.onConfirm).not.toHaveBeenCalled();
  type(screen, ['2', '1', '0', '0']);
  fireEvent.press(screen.getByText('Set amount'));
  expect(p.onConfirm).toHaveBeenCalledWith(2100, undefined);
});
test('quick dollar amounts, any amount and a note go into the request', () => {
  const p = props(); const screen = render(<AmountEditorModal {...p} />);
  fireEvent.press(screen.getByLabelText('Request 5 dollars'));
  fireEvent.changeText(screen.getByLabelText('Request note'), '  Pizza on Friday ');
  fireEvent.press(screen.getByText('Save request'));
  // $5 at $60,000/BTC.
  expect(p.onConfirm).toHaveBeenCalledWith(8333, { expirySeconds: 3600, showCountdown: false, note: 'Pizza on Friday' });
  p.onConfirm.mockClear();
  fireEvent.press(screen.getByLabelText('Any amount: the sender decides'));
  fireEvent.press(screen.getByText('Save request'));
  expect(p.onConfirm).toHaveBeenCalledWith(0, expect.objectContaining({ note: 'Pizza on Friday' }));
});
test('asset mode shows the ticker, a Max chip and its own decimals', () => {
  const onConfirmAssetUnits = jest.fn();
  const p = { visible: true, onClose: jest.fn(), onConfirm: jest.fn(), onConfirmAssetUnits, rates: { usd: 60000 },
    asset: { unit: 'USDB', maxUnits: 123.45, availableLabel: '123.45 USDB available', decimals: 2 } };
  const screen = render(<AmountEditorModal {...p} />);
  expect(screen.getByText('Amount in USDB')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Send all USDB'));
  expect(screen.getByText('123.45')).toBeTruthy();
  type(screen, ['9']); // decimals already full: ignored
  fireEvent.press(screen.getByText('Set amount'));
  expect(onConfirmAssetUnits).toHaveBeenCalledWith(123.45);
  onConfirmAssetUnits.mockClear();
  type(screen, ['back', 'back', 'back', 'back', 'back', 'back']);
  type(screen, ['9', '9', '9', '9', '9']);
  fireEvent.press(screen.getByText('Set amount'));
  expect(onConfirmAssetUnits).not.toHaveBeenCalled(); // over the balance
});
