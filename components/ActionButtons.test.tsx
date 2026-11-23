import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ActionButtons } from './ActionButtons';

test('calls the matching wallet action from each labeled tile', () => {
  const onReceive = jest.fn();
  const onSend = jest.fn();
  const onSwap = jest.fn();
  const screen = render(<ActionButtons {...{ onReceive, onSend, onSwap }} />);

  fireEvent.press(screen.getByLabelText('Receive'));
  expect(onReceive).toHaveBeenCalledTimes(1);
  expect(onSend).not.toHaveBeenCalled();
  expect(onSwap).not.toHaveBeenCalled();

  fireEvent.press(screen.getByLabelText('Send'));
  fireEvent.press(screen.getByLabelText('Swap'));
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSwap).toHaveBeenCalledTimes(1);
});
