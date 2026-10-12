import React from 'react';
import { render } from '@testing-library/react-native';
import { PaymentReceiptDetails } from './PaymentReceiptDetails';
const details = { amount: '5,000 sats', recipient: 'Alice', fees: '12 sats', total: '5,012 sats', account: 'Spark' };
test('keeps recipient, amount, fees and total explicit without implying estimated fees are final', () => {
  const ui = render(<PaymentReceiptDetails details={details} />);
  for (const value of ['Alice', '5,000 sats', '12 sats', '5,012 sats', 'Quoted fees', 'Quoted total']) expect(ui.getByText(value)).toBeTruthy();
});
test('older receipts never invent a recipient or zero fee', () => {
  const ui = render(<PaymentReceiptDetails details={{ amount: '1,000 sats', total: '1,010 sats' }} />);
  expect(ui.getByText('Not saved with this payment')).toBeTruthy();
  expect(ui.getByText('Not recorded')).toBeTruthy();
  expect(ui.queryByText('No fee')).toBeNull();
});
