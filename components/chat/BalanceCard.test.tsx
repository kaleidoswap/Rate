import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BalanceCard } from './BalanceCard';

it('keeps the summary short without losing networks or assets in the detail', () => {
  const screen = render(<BalanceCard data={{ total_sats: 125000, layers: [
    { layer: 'spark', btc_sats: 80000 },
    { layer: 'arkade', btc_sats: 40000 },
    { layer: 'rln', btc_sats: 5000, assets: [{ ticker: 'USDT', balance: 25 }] },
  ] }} />);
  expect(screen.getByText('125,000 sats')).toBeTruthy();
  expect(screen.getByText('+1 more · View details')).toBeTruthy();
  expect(screen.queryByText('Lightning / RGB')).toBeNull();
  fireEvent.press(screen.getByLabelText('Open balance details'));
  expect(screen.getByText('Lightning / RGB')).toBeTruthy();
  expect(screen.getByText('5,000 sats')).toBeTruthy();
  expect(screen.getByText('USDT')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Close balance details'));
  expect(screen.queryByText('Lightning / RGB')).toBeNull();
  expect(screen.getByText('125,000 sats')).toBeTruthy();
});
it('shows a zero balance and no invented fiat amount', () => {
  const screen = render(<BalanceCard data={{ total_sats: 0, layers: [] }} />);
  expect(screen.getByText('0 sats')).toBeTruthy();
  expect(screen.queryByText(/≈/)).toBeNull();
  fireEvent.press(screen.getByLabelText('Open balance details'));
  expect(screen.getByLabelText('Close balance details')).toBeTruthy();
});
