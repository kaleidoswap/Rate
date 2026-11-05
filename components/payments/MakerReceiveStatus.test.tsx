import React from 'react';
import { render } from '@testing-library/react-native';
import { MakerReceiveStatus } from './MakerReceiveStatus';
const receipt = { rfqId: 'r', invoice: 'ln-test', amountSats: 10000, payAmountSats: 10030, provider: 'KaleidoSwap', expiresAt: 100 };
test('a completed receipt is not presented as an expired payable invoice', () => {
  const v = render(<MakerReceiveStatus receipt={receipt} phase="settled" connected now={101000} />);
  expect(v.getByText('Received in Arkade')).toBeTruthy();
  expect(v.queryByText(/Payment window/)).toBeNull();
});
test('pending expiry preserves recovery instructions', () => {
  const v = render(<MakerReceiveStatus receipt={receipt} phase="checking" connected now={101000} />);
  expect(v.getByText('Payment window closed. Checking the existing swap; do not pay this invoice again.')).toBeTruthy();
});
test('remaining time is rounded up and closed receipts do not invite another payment', () => {
  const v = render(<MakerReceiveStatus receipt={receipt} phase="prepared" connected now={98400} />);
  expect(v.getByText('Payment window: 2s remaining')).toBeTruthy();
  v.rerender(<MakerReceiveStatus receipt={receipt} phase="cancelled" connected now={101000} />);
  expect(v.getByText('Request closed')).toBeTruthy();
  expect(v.queryByText(/Payment window/)).toBeNull();
});
