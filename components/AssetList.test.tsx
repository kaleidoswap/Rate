import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AssetList, formatUsd } from './AssetList';
import { buildAssetListItems, LITE_USD_KEY, type AssetListItem, type BuildAssetListArgs } from '../utils/asset-list-model';

const token = (id: string) => ({
  asset_id: id,
  ticker: id,
  name: id,
  precision: 0,
  balance: 42,
  protocol: 'RGB',
});

function items(options: Partial<BuildAssetListArgs> = {}) {
  return buildAssetListItems({ btcAvailable: 21_000, showBtc: true, btcPriceUSD: 100_000, assets: [], ...options });
}

test('a row shows the amount with its unit and its dollar value', () => {
  const onAssetPress = jest.fn();
  const screen = render(<AssetList items={items()} bitcoinUnit="sats" showNetworks={false} onAssetPress={onAssetPress} />);
  fireEvent.press(screen.getByLabelText('Bitcoin, 21,000 sats, about $21.00'));
  expect(onAssetPress).toHaveBeenCalledWith(expect.objectContaining({ key: 'BTC' }));
});

test('renders the full portfolio without default search or network controls', () => {
  const assets = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT'].map(token);
  const screen = render(
    <AssetList items={items({ assets })} bitcoinUnit="sats" showNetworks={false} onAssetPress={jest.fn()} />
  );
  expect(screen.getByLabelText(/^FOXTROT,/)).toBeTruthy();
  expect(screen.getByLabelText(/^ECHO,/)).toBeTruthy();
  expect(screen.queryByLabelText('Search assets')).toBeNull();
  expect(screen.queryByLabelText('RGB')).toBeNull();
});

test('dollar formatting keeps cents and small values readable', () => {
  expect(formatUsd(1234.5)).toBe('$1,234.50');
  expect(formatUsd(0.0042)).toBe('$0.0042');
});

test('masks asset balances and fiat values visually and in accessibility labels', () => {
  const onAssetPress = jest.fn();
  const screen = render(<AssetList hideBalances bitcoinUnit="sats" showNetworks onAssetPress={onAssetPress}
    items={items({ showBtc: false, assets: [token('USDT')] })} />);
  const row = screen.getByLabelText('USDT, on RGB, balance hidden');
  expect(screen.getByText('••••')).toBeTruthy();
  expect(screen.queryByText(/42/)).toBeNull();
  fireEvent.press(row);
  expect(onAssetPress).toHaveBeenCalledWith(expect.objectContaining({ ticker: 'USDT' }));
});

test('expands the USD total in place and opens the selected token and network', () => {
  const holdings = items({ showBtc: false, assets: [
    { ...token('rgb:usd'), ticker: 'USDT', name: 'RGB Dollars', balance: 400 },
    { ...token('btkn1usd'), ticker: 'USDB', name: 'Spark Dollars', protocol: 'SPARK', balance: 10 },
  ] });
  const total: AssetListItem = {
    key: LITE_USD_KEY, ticker: 'USD', name: 'US Dollar', precision: 2, amount: 410,
    networks: ['rgb', 'spark'], holdings: holdings.flatMap(item => item.holdings), isBtc: false,
  };
  const onAssetPress = jest.fn();
  const props = { items: [total], bitcoinUnit: 'sats' as const, showNetworks: true, onAssetPress };
  const screen = render(<AssetList {...props} walletKey="first" />);
  const aggregate = () => screen.getByLabelText(/^US Dollar, 410 USD/);
  expect(aggregate().props.accessibilityState.expanded).toBe(false);
  expect(screen.queryByLabelText(/^Spark Dollars/)).toBeNull();

  fireEvent.press(aggregate());
  expect(aggregate().props.accessibilityState.expanded).toBe(true);
  expect(onAssetPress).not.toHaveBeenCalled();
  expect(screen.getByLabelText('RGB Dollars, 400 USDT, on RGB')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Spark Dollars, 10 USDB, on Spark'));
  expect(onAssetPress).toHaveBeenCalledWith(expect.objectContaining({ key: 'asset:spark:btkn1usd', networks: ['spark'] }));

  screen.rerender(<AssetList {...props} walletKey="second" />);
  expect(screen.queryByLabelText(/^Spark Dollars/)).toBeNull();
});
