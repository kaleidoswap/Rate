import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import AssetDetailScreen from './AssetDetailScreen';

let mockAssets: any[] = [];
jest.mock('../store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (f: any) => f({ assets: { rgbAssets: mockAssets } }),
}));
jest.mock('../store/slices/walletSlice', () => ({ loadBtcBalance: () => ({ type: 'loadBtcBalance' }) }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader' }));

const usdt = {
  asset_id: 'rgb:usdt-id-0123456789abcdefghijkl', ticker: 'USDT', name: 'Tether USD', precision: 6, issued_supply: 1_000_000_000_000,
  protocol: 'RGB' as const, isRGB: true, balance: { settled: 40_500_000, future: 50_500_000, spendable: 40_500_000, offchain_outbound: 2_000_000 },
};
const open = (asset: any, navigation: any = { navigate: jest.fn(), goBack: jest.fn() }) =>
  ({ navigation, screen: render(<AssetDetailScreen navigation={navigation} route={{ params: { asset } }} />) });

beforeEach(() => { mockAssets = []; });

test('shows the balance in the asset unit, its breakdown and details', () => {
  const { screen } = open(usdt);
  expect(screen.getByLabelText('Balance 40.5 USDT')).toBeTruthy();
  expect(screen.getByText('+10 USDT incoming')).toBeTruthy();   // incoming = future − settled, once (in the hero)
  expect(screen.getByText('2 USDT')).toBeTruthy();              // in Lightning channels
  expect(screen.getByText('1,000,000 USDT')).toBeTruthy();      // issued supply, formatted
  expect(screen.getByText('rgb:usdt-i…efghijkl')).toBeTruthy();   // asset id, middle-truncated
});

test('actions open Receive and Send for this asset', () => {
  const { screen, navigation } = open(usdt);
  fireEvent.press(screen.getByLabelText('Receive USDT'));
  expect(navigation.navigate).toHaveBeenCalledWith('Receive', { selectedAsset: { asset_id: usdt.asset_id, ticker: 'USDT', name: 'Tether USD', isRGB: true } });
  fireEvent.press(screen.getByLabelText('Send USDT'));
  expect(navigation.navigate).toHaveBeenCalledWith('Send', expect.anything());
});

test('bitcoin shows the unit and dollar value it was opened with, and no asset id', () => {
  const { screen } = open({ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', precision: 0, unit: 'sats', balance: { spendable: 125_430 }, fiatValue: 125.43 });
  expect(screen.getByLabelText('Balance 125,430 sats, about $125.43')).toBeTruthy();
  expect(screen.queryByText('Asset ID')).toBeNull();
});

test('a live balance from the store replaces the one it was opened with', () => {
  mockAssets = [{ asset_id: usdt.asset_id, balance: { settled: 1_000_000, future: 1_000_000, spendable: 1_000_000 } }];
  const { screen } = open(usdt);
  expect(screen.getByLabelText('Balance 1 USDT')).toBeTruthy();
});

test('missing asset data goes back', () => {
  const { navigation } = open(undefined);
  expect(navigation.goBack).toHaveBeenCalled();
});

test('says each thing once: no ticker, network or balance rows repeating the hero', () => {
  const { screen } = open(usdt);
  for (const repeated of ['Ticker', 'Network', 'Available to send', 'Incoming', 'Settled']) expect(screen.queryByText(repeated)).toBeNull();
  expect(screen.queryAllByText('Tether USD').length).toBe(0); // the header (mocked) carries the name
});
