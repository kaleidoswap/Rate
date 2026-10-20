import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ActionableError } from './ActionableError';

test('keeps diagnostics available without claiming a failed payment moved no funds', () => {
  const ui = render(<ActionableError context="send" message="RPC timeout" />);
  expect(ui.getByText(/check Activity before sending again/)).toBeTruthy();
  expect(ui.queryByText('RPC timeout')).toBeNull();
  fireEvent.press(ui.getByText('Error details'));
  expect(ui.getByText('RPC timeout')).toBeTruthy();
  ui.rerender(<ActionableError context="receive" message="Connection unavailable" />);
  expect(ui.queryByText('Connection unavailable')).toBeNull();
  expect(ui.getByText('Could not prepare your request')).toBeTruthy();
});
