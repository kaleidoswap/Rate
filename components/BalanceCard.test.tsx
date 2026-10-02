import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BalanceCard } from './BalanceCard';

const props = {
  totalBalance: 1500, pendingBtc: 500,
  bitcoinUnit: 'sats', onRefresh: jest.fn(), refreshing: false,
  formatSatoshis: (n: number) => String(n), formatUSD: (n: number) => String(n / 100),
  onChainBalance: 1500, lightningBalance: 0,
  byProtocol: { SPARK: { confirmed: 1000, unconfirmed: 500, total: 1500 } },
  primaryText: '1500', primaryUnitLabel: 'sats', onCycleDenomination: jest.fn(),
};

describe('balance disclosure', () => {
  it('keeps the balance uncluttered: unit inline, tap the amount to change it', () => {
    const screen = render(<BalanceCard {...props} />);
    expect(screen.queryByText('Available bitcoin')).toBeNull();
    expect(screen.queryByText(/Spendable amount depends/)).toBeNull();
    expect(screen.queryByText(/Pending:/)).toBeNull();
    // No separate unit picker row below the amount.
    expect(screen.queryByLabelText(/Change balance unit/)).toBeNull();
    expect(screen.getByText('sats')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Total balance 1500 sats. Tap to change unit.'));
    expect(props.onCycleDenomination).toHaveBeenCalled();
  });

  it('shows no inline unit for fiat, whose figure already carries the symbol', () => {
    const screen = render(<BalanceCard {...props} primaryText="$12.00" primaryUnitLabel="USD" />);
    expect(screen.getByText('$12.00')).toBeTruthy();
    expect(screen.queryByText('USD')).toBeNull();
  });
  it('keeps new availability and network rows private when balances are hidden', () => {
    const screen = render(<BalanceCard {...props} hideAmounts primaryText="••••" primaryUnitLabel="" />);
    fireEvent.press(screen.getByLabelText('Show network balances'));
    expect(screen.queryByText('1000 sats')).toBeNull();
    expect(screen.queryByText('500 sats')).toBeNull();
    expect(screen.queryByText('1500 sats')).toBeNull();
    expect(screen.queryByText('$15')).toBeNull();
  });
});
