import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ReceiveMethodsSheet } from './ReceiveMethodsSheet';
jest.mock('./ReceiveQr', () => ({ ReceiveQr: ({ value }: { value: string }) => <>{value}</> }));
jest.mock('./ReceiveRequestActions', () => ({ ReceiveRequestActions: () => null }));
jest.mock('../payments/InvoiceExpiry', () => ({ InvoiceExpiry: () => null }));
const methods = [{ key: 'spark', label: 'Spark', value: 'spark:one' }, { key: 'ark', label: 'Arkade', value: 'ark:two' }];
test('method details follow the current value and disappear when the method is removed', () => {
  const props = { visible: true, methods, qrSize: 248, onClose: jest.fn() };
  const screen = render(<ReceiveMethodsSheet {...props} />);
  fireEvent.press(screen.getByLabelText('Show Spark payment code'));
  expect(screen.getByText('Ask the sender to use Spark.')).toBeTruthy();
  screen.rerender(<ReceiveMethodsSheet {...props} methods={[methods[1]]} />);
  expect(screen.queryByText('Ask the sender to use Spark.')).toBeNull();
  expect(screen.getByLabelText('Show Arkade payment code')).toBeTruthy();
});
test('back returns to methods and closing clears the selected method on reopening', () => {
  const props = { visible: true, methods, qrSize: 248, onClose: jest.fn() };
  const screen = render(<ReceiveMethodsSheet {...props} />);
  fireEvent.press(screen.getByLabelText('Show Spark payment code'));
  fireEvent.press(screen.getByLabelText('Back to payment methods'));
  fireEvent.press(screen.getByLabelText('Show Arkade payment code'));
  fireEvent.press(screen.getByLabelText('Close payment methods'));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  screen.rerender(<ReceiveMethodsSheet {...props} visible={false} />);
  screen.rerender(<ReceiveMethodsSheet {...props} />);
  expect(screen.getByLabelText('Show Spark payment code')).toBeTruthy();
});

test('keeps account and network controls behind an explicit advanced action', () => {
  const { Text } = require('react-native'); const onAdvancedOpen = jest.fn();
  const screen = render(<ReceiveMethodsSheet visible methods={methods} qrSize={248} onClose={jest.fn()} onAdvancedOpen={onAdvancedOpen}><Text>Account options</Text></ReceiveMethodsSheet>);
  expect(screen.queryByText('Account options')).toBeNull();
  fireEvent.press(screen.getByLabelText('Advanced receive options'));
  expect(screen.getByText('Account options')).toBeTruthy(); expect(onAdvancedOpen).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Advanced receive options'));
  expect(screen.queryByText('Account options')).toBeNull();
});
