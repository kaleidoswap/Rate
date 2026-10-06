import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ReceiveQr } from './ReceiveQr';
let finish: () => void;
beforeEach(() => {
  jest.useFakeTimers();
  (require('react-native') as any).InteractionManager = { runAfterInteractions: jest.fn(cb => { finish = cb; return { cancel: jest.fn() }; }) };
});
afterEach(() => jest.useRealTimers());
test('removes the previous QR immediately when its amount or destination changes', () => {
  const screen = render(<ReceiveQr value="bitcoin:address?amount=0.001" size={248} />);
  act(() => { finish(); jest.runOnlyPendingTimers(); });
  expect(screen.UNSAFE_getByType('QRCode' as any).props.value).toBe('bitcoin:address?amount=0.001');
  screen.rerender(<ReceiveQr value="bitcoin:address?amount=0.002" size={248} />);
  expect(screen.UNSAFE_queryByType('QRCode' as any)).toBeNull();
  act(() => { finish(); jest.runOnlyPendingTimers(); });
  expect(screen.UNSAFE_getByType('QRCode' as any).props.value).toBe('bitcoin:address?amount=0.002');
});
test('tapping the code opens it full screen; tapping again closes it', () => {
  const { fireEvent } = require('@testing-library/react-native');
  const screen = render(<ReceiveQr value="bitcoin:address" size={248} />);
  act(() => { finish(); jest.runOnlyPendingTimers(); });
  expect(screen.UNSAFE_getAllByType('QRCode' as any)).toHaveLength(1);
  fireEvent.press(screen.getByLabelText('Enlarge payment code'));
  expect(screen.UNSAFE_getAllByType('QRCode' as any)).toHaveLength(2);
  fireEvent.press(screen.getByLabelText('Close enlarged code'));
  expect(screen.UNSAFE_getAllByType('QRCode' as any)).toHaveLength(1);
});
