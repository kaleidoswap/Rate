import React from 'react';
import { render } from '@testing-library/react-native';
import { ReceiveStatus } from './ReceiveStatus';

test('an open RGB request is not described as a transfer already in progress', () => {
  const ui = render(<ReceiveStatus visible status="watching" requestOnly />);
  expect(ui.getByText('Request ready')).toBeTruthy();
  expect(ui.getByText(/No transfer detected yet/)).toBeTruthy();
  ui.rerender(<ReceiveStatus visible status="pending" requestOnly />);
  expect(ui.getByText('Payment detected · confirming')).toBeTruthy();
  expect(ui.queryByText(/No transfer detected yet/)).toBeNull();
  ui.rerender(<ReceiveStatus visible status="confirmed" requestOnly />);
  expect(ui.getByText('Payment received')).toBeTruthy();
});
