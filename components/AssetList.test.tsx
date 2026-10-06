import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AssetList, formatUsd } from './AssetList';

const asset = (id: string, extra: object = {}) => ({ asset_id: id, ticker: id, name: id, precision: 0, balance: { spendable: 5 }, ...extra });

test('a row shows the amount with its unit and its dollar value', () => {
  const onAssetPress = jest.fn();
  const screen = render(<AssetList onViewAll={jest.fn()} onIssueAsset={jest.fn()} onAssetPress={onAssetPress}
    assets={[asset('BTC', { name: 'Bitcoin', precision: 0, balance: { spendable: 21000 }, unit: 'sats', fiatValue: 13.37, protocol: undefined })]} />);
  fireEvent.press(screen.getByLabelText('Bitcoin, 21,000 sats, about $13.37'));
  expect(onAssetPress).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'BTC' }));
});

test('shows four assets and folds the rest into "View N more"', () => {
  const onViewAll = jest.fn();
  const screen = render(<AssetList onViewAll={onViewAll} onIssueAsset={jest.fn()} onAssetPress={jest.fn()}
    assets={['A', 'B', 'C', 'D', 'E', 'F'].map(id => asset(id))} />);
  expect(screen.queryByText('E')).toBeNull();
  fireEvent.press(screen.getByLabelText('View 2 more assets'));
  expect(onViewAll).toHaveBeenCalled();
});

test('dollar formatting keeps cents and small values readable', () => {
  expect(formatUsd(1234.5)).toBe('$1,234.50');
  expect(formatUsd(0.0042)).toBe('$0.0042');
});
