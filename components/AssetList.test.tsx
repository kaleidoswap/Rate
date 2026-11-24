import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AssetList, formatUsd } from './AssetList';
import { buildAssetListItems, type BuildAssetListArgs } from '../utils/asset-list-model';

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

test('renders the full portfolio and clears a search without leaving the list', () => {
  const assets = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT'].map(token);
  const screen = render(
    <AssetList items={items({ assets })} bitcoinUnit="sats" showNetworks={false} onAssetPress={jest.fn()} />
  );
  expect(screen.getByLabelText(/^FOXTROT,/)).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'echo');
  expect(screen.getByLabelText(/^ECHO,/)).toBeTruthy();
  expect(screen.queryByLabelText(/^FOXTROT,/)).toBeNull();
  fireEvent.press(screen.getByLabelText('Clear search'));
  expect(screen.getByLabelText(/^FOXTROT,/)).toBeTruthy();
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
