import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BalanceCard } from './BalanceCard';

const props = {
  totalBalance: 1500, availableBtc: 1000, pendingBtc: 500,
  bitcoinUnit: 'sats', onRefresh: jest.fn(), refreshing: false,
  formatSatoshis: (n: number) => String(n), formatUSD: (n: number) => String(n / 100),
  onChainBalance: 1500, lightningBalance: 0,
  byProtocol: { SPARK: { confirmed: 1000, unconfirmed: 500, total: 1500 } },
  primaryText: '1500', primaryUnitLabel: 'sats', onCycleDenomination: jest.fn(),
};

describe('balance disclosure', () => {
  it('separates spendable bitcoin from unavailable funds and exposes the unit control', () => {
    const screen = render(<BalanceCard {...props} />);
    expect(screen.getByText('Available bitcoin')).toBeTruthy();
    expect(screen.getByText('1000 sats')).toBeTruthy();
    expect(screen.getByText('Pending / unavailable')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Total balance 1500 sats. Tap to change denomination.'));
    expect(props.onCycleDenomination).toHaveBeenCalled();
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
