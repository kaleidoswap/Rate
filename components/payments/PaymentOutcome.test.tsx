import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PaymentOutcome, paymentMethod } from './PaymentOutcome';
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
it('shows the status as a badge, the fees without opening details, and the network once opened', () => {
  const ui = render(<PaymentOutcome attempt={{ ...attempt, status: 'pending', destinationRail: 'ln:signet', network: 'signet', reference: 'b9e837f55fba60daca3fb583953b546b33ad4aa2493812126a054925f56c9345' }} />);
  expect(ui.getByText('In progress')).toBeTruthy();
  expect(ui.getByText('Quoted fees')).toBeTruthy();
  expect(ui.getByText('Quoted total')).toBeTruthy();
  fireEvent.press(ui.getByText('Payment details'));
  expect(ui.getByText('Lightning · signet')).toBeTruthy();
  expect(ui.getByText('b9e837f5…f56c9345')).toBeTruthy();
  expect(ui.getByLabelText('Copy reference')).toBeTruthy();
});
it('a failed payment says so plainly', () => {
  const ui = render(<PaymentOutcome attempt={{ ...attempt, status: 'failed' }} />);
  expect(ui.getAllByText('Payment failed').length).toBeGreaterThan(0);
  expect(ui.getByText('Failed')).toBeTruthy();
});
it('names the way a payment was made', () => {
  expect(paymentMethod({ destinationRail: 'btc:mainnet', network: 'mainnet' })).toEqual({ label: 'Bitcoin', icon: 'onchain' });
  expect(paymentMethod({})).toBeUndefined();
});
