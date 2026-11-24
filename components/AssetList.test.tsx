import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AssetList, formatUsd } from './AssetList';

const asset = (id: string, extra: object = {}) => ({ asset_id: id, ticker: id, name: id, precision: 0, balance: { spendable: 5 }, ...extra });

test('a row shows the amount with its unit and its dollar value', () => {
  const onAssetPress = jest.fn();
  const screen = render(<AssetList onViewAll={jest.fn()} onAssetPress={onAssetPress}
    assets={[asset('BTC', { name: 'Bitcoin', precision: 0, balance: { spendable: 21000 }, unit: 'sats', fiatValue: 13.37, protocol: undefined })]} />);
  fireEvent.press(screen.getByLabelText('Bitcoin, 21,000 sats, about $13.37'));
  expect(onAssetPress).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'BTC' }));
});

test('shows four assets; the rest are behind the header\'s View All link', () => {
  const onViewAll = jest.fn();
  const screen = render(<AssetList onViewAll={onViewAll} onAssetPress={jest.fn()}
    assets={['A', 'B', 'C', 'D', 'E', 'F'].map(id => asset(id))} />);
  expect(screen.queryByText('E')).toBeNull();
  expect(screen.queryByText(/more assets/)).toBeNull();
  fireEvent.press(screen.getByLabelText('View All'));
  expect(onViewAll).toHaveBeenCalled();
});

test('dollar formatting keeps cents and small values readable', () => {
  expect(formatUsd(1234.5)).toBe('$1,234.50');
  expect(formatUsd(0.0042)).toBe('$0.0042');
});

test('masks asset balances and fiat values visually and in accessibility labels', () => {
  const onAssetPress = jest.fn();
  const screen = render(<AssetList hideAmounts onViewAll={jest.fn()} onAssetPress={onAssetPress}
    assets={[asset('USDT', { protocol: 'RGB', balance: { spendable: 42 }, fiatValue: 42 })]} />);
  const row = screen.getByLabelText('USDT on RGB, balance hidden');
  expect(screen.getByText('••••')).toBeTruthy();
  expect(screen.queryByText(/42/)).toBeNull();
  fireEvent.press(row);
  expect(onAssetPress).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'USDT' }));
});

test('managing the home list hides and restores an asset and fills the visible slots', () => {
  const assets = ['A', 'B', 'C', 'D', 'E'].map(id => asset(id));
  const onSetHidden = jest.fn();
  const props = { assets, onSetHidden, onAssetPress: jest.fn(), onViewAll: jest.fn() };
  const screen = render(<AssetList {...props} />);
  expect(screen.queryByLabelText('E, 5 E')).toBeNull();
  fireEvent.press(screen.getByLabelText('Manage assets on Home'));
  fireEvent.press(screen.getByRole('checkbox', { name: 'A', checked: true }));
  expect(onSetHidden).toHaveBeenLastCalledWith('wallet:A', true);

  screen.rerender(<AssetList {...props} hiddenAssetKeys={['wallet:A']} />);
  expect(screen.queryByLabelText('A, 5 A')).toBeNull();
  expect(screen.getByLabelText('E, 5 E')).toBeTruthy();
  fireEvent.press(screen.getByRole('checkbox', { name: 'A', checked: false }));
  expect(onSetHidden).toHaveBeenLastCalledWith('wallet:A', false);
  expect(assets).toHaveLength(5);
});

test('asset controls stay reachable with every asset hidden', () => {
  const onViewAll = jest.fn();
  const screen = render(<AssetList assets={[asset('BTC')]} onAssetPress={jest.fn()}
    onViewAll={onViewAll} hiddenAssetKeys={['wallet:BTC']} onSetHidden={jest.fn()} />);
  expect(screen.getByText('All assets are hidden on Home')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('View All'));
  expect(onViewAll).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Manage assets on Home'));
  expect(screen.getByRole('checkbox', { name: 'BTC', checked: false })).toBeTruthy();
});
