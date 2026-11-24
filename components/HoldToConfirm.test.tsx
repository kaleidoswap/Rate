import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { HoldToConfirm } from './HoldToConfirm';

jest.mock('../utils/feedback', () => ({ feedback: { tap: jest.fn() } }));

it('confirms once after a continuous hold and ignores a tap or an early release', () => {
  const onConfirm = jest.fn();
  const screen = render(<HoldToConfirm label="Pay 1,010 sats" onConfirm={onConfirm} />);
  const control = screen.getByRole('button', { name: 'Pay 1,010 sats' });

  fireEvent.press(control);
  fireEvent(control, 'pressIn');
  fireEvent(control, 'pressOut');
  fireEvent(control, 'longPress');
  expect(onConfirm).not.toHaveBeenCalled();

  fireEvent(control, 'pressIn');
  fireEvent(control, 'longPress');
  fireEvent(control, 'longPress');
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it('offers accessible activation once and prevents confirmation during loading', () => {
  const onConfirm = jest.fn();
  const screen = render(<HoldToConfirm label="Pay" onConfirm={onConfirm} />);
  const activate = () => fireEvent(screen.getByLabelText('Pay'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  activate();
  activate();
  expect(onConfirm).toHaveBeenCalledTimes(1);

  screen.rerender(<HoldToConfirm label="Pay" onConfirm={onConfirm} loading />);
  activate();
  expect(screen.getByText('Sending…')).toBeTruthy();
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it('cancels the current hold when payment temporarily becomes unavailable', () => {
  const onConfirm = jest.fn();
  const screen = render(<HoldToConfirm label="Pay" onConfirm={onConfirm} />);
  fireEvent(screen.getByLabelText('Pay'), 'pressIn');
  screen.rerender(<HoldToConfirm label="Pay" onConfirm={onConfirm} disabled />);
  screen.rerender(<HoldToConfirm label="Pay" onConfirm={onConfirm} />);
  fireEvent(screen.getByLabelText('Pay'), 'longPress');
  expect(onConfirm).not.toHaveBeenCalled();
});
