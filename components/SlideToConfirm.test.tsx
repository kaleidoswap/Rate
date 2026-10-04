import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SlideToConfirm } from './SlideToConfirm';

const activate = (el: any) => fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });

test('reads as the action and confirms through the accessibility action', () => {
  const onConfirm = jest.fn();
  const screen = render(<SlideToConfirm label="Pay 1,010 sats" onConfirm={onConfirm} />);
  expect(screen.getByText('Slide to pay 1,010 sats')).toBeTruthy();
  activate(screen.getByLabelText('Pay 1,010 sats'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('does nothing while disabled or busy', () => {
  const onConfirm = jest.fn();
  const screen = render(<SlideToConfirm label="Pay" onConfirm={onConfirm} disabled />);
  activate(screen.getByLabelText('Pay'));
  screen.rerender(<SlideToConfirm label="Pay" onConfirm={onConfirm} loading />);
  expect(screen.getByText('Sending…')).toBeTruthy();
  activate(screen.getByLabelText('Pay'));
  expect(onConfirm).not.toHaveBeenCalled();
});
