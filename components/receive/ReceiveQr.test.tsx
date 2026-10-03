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
