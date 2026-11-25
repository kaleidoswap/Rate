import React from 'react';
import { Alert, Animated } from 'react-native';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { HoldToConfirm } from './HoldToConfirm';

jest.mock('../utils/feedback', () => ({ feedback: { tap: jest.fn() } }));

const label = 'Pay 1,010 sats';
const alternative = 'Confirm without holding';
const activate = (element: ReturnType<RenderResult['getByLabelText']>) => {
  fireEvent(element, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
};

function alertAction(text: string) {
  return jest.mocked(Alert.alert).mock.lastCall?.[2]?.find(button => button.text === text)?.onPress;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test('a tap or early release cannot confirm a payment', () => {
  const onConfirm = jest.fn();
  const ui = render(<HoldToConfirm label={label} onConfirm={onConfirm} />);
  const control = ui.getByLabelText(label);
  expect(ui.getByText('Hold to pay 1,010 sats')).toBeTruthy();
  fireEvent.press(control);
  fireEvent(control, 'pressIn');
  fireEvent(control, 'pressOut');
  fireEvent(control, 'longPress');
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

test('holding confirms once and blocks both paths while the payment is running', async () => {
  let resolvePayment: () => void = () => {};
  const onConfirm = jest.fn(() => new Promise<void>(resolve => { resolvePayment = resolve; }));
  const ui = render(<HoldToConfirm label={label} onConfirm={onConfirm} />);
  const control = ui.getByLabelText(label);
  fireEvent(control, 'pressIn');
  expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 1200, useNativeDriver: true }));
  fireEvent(control, 'longPress');
  fireEvent(control, 'longPress');
  fireEvent(control, 'pressOut');
  activate(control);
  fireEvent.press(ui.getByText(alternative));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(ui.getByText('Processing…')).toBeTruthy();
  await act(async () => resolvePayment());
  expect(ui.queryByText('Processing…')).toBeNull();
});

test('the alternate path asks explicitly for confirmation and handles cancellation', async () => {
  const onConfirm = jest.fn();
  const ui = render(<HoldToConfirm label={label} onConfirm={onConfirm} />);
  fireEvent(ui.getByLabelText(label), 'accessibilityTap');
  activate(ui.getByLabelText(label));
  expect(Alert.alert).toHaveBeenCalledWith('Confirm transaction', label, expect.any(Array), expect.any(Object));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  const cancelledConfirm = alertAction('Confirm');
  alertAction('Cancel')?.();
  cancelledConfirm?.();
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText(alternative));
  const confirm = alertAction('Confirm');
  await act(async () => { confirm?.(); confirm?.(); });
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('a new quote invalidates an in-progress hold and an old dialog', async () => {
  const onConfirm = jest.fn();
  const ui = render(<HoldToConfirm label={label} confirmationKey="quote-1" onConfirm={onConfirm} />);
  const control = ui.getByLabelText(label);
  fireEvent(control, 'pressIn');
  ui.rerender(<HoldToConfirm label={label} confirmationKey="quote-2" onConfirm={onConfirm} />);
  fireEvent(control, 'longPress');
  expect(onConfirm).not.toHaveBeenCalled();
  activate(control);
  const staleConfirm = alertAction('Confirm');
  expect(staleConfirm).toBeDefined();
  ui.rerender(<HoldToConfirm label={label} confirmationKey="quote-3" onConfirm={onConfirm} />);
  staleConfirm?.();
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => { fireEvent(control, 'pressIn'); fireEvent(control, 'longPress'); });
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('loading disables confirmation and invalidates a previously opened dialog', () => {
  const onConfirm = jest.fn();
  const ui = render(<HoldToConfirm label={label} onConfirm={onConfirm} />);
  activate(ui.getByLabelText(label));
  const staleConfirm = alertAction('Confirm');
  ui.rerender(<HoldToConfirm label={label} onConfirm={onConfirm} loading />);
  staleConfirm?.();
  const control = ui.getByLabelText(label);
  activate(control);
  fireEvent(control, 'pressIn');
  fireEvent(control, 'longPress');
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(control.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
});

test('Reduce Motion keeps the hold safeguard without animating progress', async () => {
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
  const onConfirm = jest.fn();
  const ui = render(<HoldToConfirm label={label} onConfirm={onConfirm} />);
  const control = ui.getByLabelText(label);
  fireEvent(control, 'pressIn');
  expect(Animated.timing).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => fireEvent(control, 'longPress'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('an unexpected payment rejection requires a status check and prevents a repeat', async () => {
  const onConfirm = jest.fn(async () => { throw new Error('Connection dropped'); });
  const ui = render(<HoldToConfirm label={label} onConfirm={onConfirm} />);
  const control = ui.getByLabelText(label);
  await act(async () => { fireEvent(control, 'pressIn'); fireEvent(control, 'longPress'); });
  expect(ui.getByLabelText('Check Activity before trying again.').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(ui.getByText(alternative));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
