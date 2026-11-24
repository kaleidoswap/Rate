import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaymentOutcome } from './PaymentOutcome';
import type { PaymentAttempt } from '../../services/kaleidoPay/attempts';
const attempt: PaymentAttempt = { id: 'example', sourceId: 'arkade', provider: 'Arkade', status: 'unknown', recipient: '500 sats', total: '500 sats', recipientName: 'Alice', feeDisplay: '0 sats', createdAt: 1791900000000 };
it('centers the loading indicator and its badge within the status ring', () => {
  const ui = render(<PaymentOutcome attempt={{ ...attempt, status: 'pending' }} />);
  const badge = ui.getByLabelText('Checking payment').parent;
  expect(StyleSheet.flatten(badge?.props.style)).toMatchObject({
    width: 64, height: 64, alignItems: 'center', justifyContent: 'center',
  });
  expect(StyleSheet.flatten(badge?.parent?.props.style)).toMatchObject({
    width: 80, height: 80, alignItems: 'center', justifyContent: 'center',
  });
});
it('keeps unknown results explicit and shows key info without a toggle', () => {
  const ui = render(<PaymentOutcome attempt={attempt} />);
  expect(ui.getByText('Payment outcome unknown')).toBeTruthy();
  expect(ui.queryByLabelText('Checking payment')).toBeNull();
  // Key rows are always visible, no toggle needed.
  expect(ui.getByText('To')).toBeTruthy();
  expect(ui.getAllByText('Alice').length).toBeGreaterThan(0);
  expect(ui.getByText('Fee')).toBeTruthy();
});
it('does not present a broadcast as a confirmed on-chain payment', () => {
  const ui = render(<PaymentOutcome attempt={{ ...attempt, sourceId: 'rgb-btc', status: 'completed' }} />);
  expect(ui.getByText('Sent to the network')).toBeTruthy();
  ui.rerender(<PaymentOutcome attempt={{ ...attempt, sourceId: 'rgb-btc', status: 'completed', onchainConfirmed: true }} />);
  expect(ui.getByText('Confirmed on-chain')).toBeTruthy();
});
it('distinguishes a verified refund from an unpaid failure', () => {
  const ui = render(<PaymentOutcome attempt={{ ...attempt, status: 'failed', resolution: 'refunded' }} />);
  expect(ui.getByText('Swap refunded')).toBeTruthy();
  expect(ui.getByText('Funds were returned to your wallet. The recipient was not paid.')).toBeTruthy();
  expect(ui.queryByText('Payment failed')).toBeNull();
});
