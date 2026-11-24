import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ActionButtons } from './ActionButtons';
import { feedback } from '../utils/feedback';

jest.mock('../utils/feedback', () => ({ feedback: { tap: jest.fn() } }));
beforeEach(() => jest.clearAllMocks());

test('calls the matching wallet action from each labeled tile', () => {
  const onReceive = jest.fn();
  const onSend = jest.fn();
  const onSwap = jest.fn();
  const screen = render(<ActionButtons {...{ onReceive, onSend, onSwap }} />);

  expect(screen.getAllByRole('button').map(button => button.props.accessibilityLabel))
    .toEqual(['Receive', 'Swap', 'Send']);
  fireEvent.press(screen.getByLabelText('Receive'));
  expect(onReceive).toHaveBeenCalledTimes(1);
  expect(onSend).not.toHaveBeenCalled();
  expect(onSwap).not.toHaveBeenCalled();

  fireEvent.press(screen.getByLabelText('Swap'));
  expect(onSwap).toHaveBeenCalledTimes(1);
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Send'));
  expect(onSend).toHaveBeenCalledTimes(1);
});

test('an unavailable action is disabled and pressing it has no effect', () => {
  const onReceive = jest.fn();
  const onSend = jest.fn();
  const screen = render(<ActionButtons onReceive={onReceive} onSend={onSend} />);

  fireEvent.press(screen.getByRole('button', { name: 'Swap', disabled: true }));
  expect(onReceive).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  expect(feedback.tap).not.toHaveBeenCalled();
});
