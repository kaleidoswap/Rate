import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PaymentOutcome } from './PaymentOutcome';
import type { PaymentAttempt } from '../../services/kaleidoPay/attempts';
const attempt: PaymentAttempt = { id: 'example', sourceId: 'arkade', provider: 'Arkade', status: 'unknown', recipient: '500 sats', total: '500 sats', recipientName: 'Alice', feeDisplay: '0 sats', createdAt: 1791900000000 };
it('keeps unknown results explicit and lets the user reveal receipt details', () => {
  const ui = render(<PaymentOutcome attempt={attempt} />);
  expect(ui.getByText('Payment outcome unknown')).toBeTruthy();
  expect(ui.queryByLabelText('Checking payment automatically')).toBeNull();
  expect(ui.queryByText('Requested')).toBeNull();
  fireEvent.press(ui.getByText('Payment details'));
  expect(ui.getByText('Requested')).toBeTruthy();
  fireEvent.press(ui.getByText('Hide details'));
  expect(ui.queryByText('Requested')).toBeNull();
});
it('does not present a broadcast as a confirmed on-chain payment', () => {
  const ui = render(<PaymentOutcome attempt={{ ...attempt, sourceId: 'rgb-btc', status: 'completed' }} />);
  expect(ui.getByText('Sent to the network')).toBeTruthy();
  ui.rerender(<PaymentOutcome attempt={{ ...attempt, sourceId: 'rgb-btc', status: 'completed', onchainConfirmed: true }} />);
  expect(ui.getByText('Confirmed on-chain')).toBeTruthy();
});
