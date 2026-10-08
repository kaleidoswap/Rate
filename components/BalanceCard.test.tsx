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

  it('lists Bark in the network breakdown like the other layers', () => {
    const screen = render(<BalanceCard {...props} byProtocol={{ ...props.byProtocol, BARK: { confirmed: 700, unconfirmed: 0, total: 700 } }} />);
    fireEvent.press(screen.getByLabelText('Show network balances'));
    expect(screen.getByText('BTC on Bark')).toBeTruthy();
    expect(screen.getByText('700 sats')).toBeTruthy();
  });

  it('no longer spells out the dollar-token share, and says it is updating', () => {
    const screen = render(<BalanceCard {...props} updating />);
    expect(screen.getByText('Total balance')).toBeTruthy();
    expect(screen.queryByText(/in dollar tokens/)).toBeNull();
    expect(screen.getByText('Updating…')).toBeTruthy();
  });

  const assetRows = [
    { key: 'usdt', ticker: 'USDT', name: 'Tether USD', network: 'rgb', networkLabel: 'RGB', amount: '12.5', usdValue: 12.5 },
    { key: 'xaut', ticker: 'XAUT', name: 'Gold', network: 'spark', networkLabel: 'Spark', amount: '3' },
  ];

  it('lists the other assets under bitcoin, with network, amount and dollar value', () => {
    const screen = render(<BalanceCard {...props} assetRows={assetRows} />);
    expect(screen.queryByText('USDT')).toBeNull();
    fireEvent.press(screen.getByLabelText('Show network balances'));
    expect(screen.getByText('Bitcoin')).toBeTruthy();
    expect(screen.getByText('Assets')).toBeTruthy();
    expect(screen.getByText('Tether USD · RGB')).toBeTruthy();
    expect(screen.getByText('12.5 USDT')).toBeTruthy();
    expect(screen.getByText('≈ $12.50')).toBeTruthy();
    // Unpriced: amount only, no fiat.
    expect(screen.getByText('Gold · Spark')).toBeTruthy();
    expect(screen.getByText('3 XAUT')).toBeTruthy();
    expect(screen.getByLabelText('3 XAUT on Spark')).toBeTruthy();
  });

  it('hides asset amounts when balances are hidden', () => {
    const screen = render(<BalanceCard {...props} hideAmounts primaryText="••••" primaryUnitLabel="" assetRows={assetRows} />);
    fireEvent.press(screen.getByLabelText('Show network balances'));
    expect(screen.getByText('USDT')).toBeTruthy();
    expect(screen.queryByText('12.5 USDT')).toBeNull();
    expect(screen.queryByText('≈ $12.50')).toBeNull();
  });

  it('opens the breakdown for assets alone, before any bitcoin account reports', () => {
    const screen = render(<BalanceCard {...props} byProtocol={undefined} assetRows={[{ key: 'usd', ticker: 'USD', name: 'US Dollar', amount: '5.00', usdValue: 5 }]} />);
    fireEvent.press(screen.getByLabelText('Show network balances'));
    expect(screen.queryByText('Bitcoin')).toBeNull();
    expect(screen.getByText('US Dollar')).toBeTruthy();
    expect(screen.getByText('5.00 USD')).toBeTruthy();
  });
});
