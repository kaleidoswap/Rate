import React from 'react';
import { DeviceEventEmitter } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import AssetsScreen from './AssetsScreen';

let mockState: any;
let mockLevel: 'lite' | 'advanced' = 'advanced';
jest.mock('react-redux', () => ({ useSelector: (fn: any) => fn(mockState), useDispatch: () => jest.fn() }));
jest.mock('../hooks/usePolicy', () => ({
  usePolicy: () => require('@kaleidorg/wallet-engine').policyFor(mockLevel),
}));
jest.mock('../utils/bitcoinUnits', () => ({
  formatBitcoinAmount: (n: number) => Math.round(n).toLocaleString('en-US'),
  useBitcoinPrice: () => 100_000,
  useDisplayAmount: () => ({ format: (sats: number) => ({ primary: String(sats), unitLabel: 'sats', secondary: '', hidden: false }), cycle: jest.fn() }),
}));
jest.mock('../components/ScreenHeader', () => ({
  ScreenHeader: ({ rightAction }: any) => rightAction ?? null,
}));
jest.mock('../components/IssueAssetModal', () => ({ IssueAssetModal: () => null }));

const stateWith = (extra: object = {}) => ({
  wallet: {
    btcBalance: {
      vanilla: { settled: 15_000, future: 15_000, spendable: 15_000 }, colored: { settled: 0, future: 0, spendable: 0 },
      byProtocol: { RGB: { confirmed: 10_000, unconfirmed: 0, total: 10_000 }, SPARK: { confirmed: 5_000, unconfirmed: 0, total: 5_000 } },
      summary: { total: 15_000, available: 14_000, unavailable: 1_000, test: 0 },
      networks: { onchain: 10_000, lightning: 0, spark: 5_000 },
    },
  },
  assets: {
    rgbAssets: [
      { asset_id: 'rgb-usdt', ticker: 'USDT', name: 'Tether USD', precision: 6, balance: 30_000_000, protocol: 'RGB',
        balanceDetail: { spendable: 30_000_000, offchain_outbound: 1 } },
      { asset_id: 'spark-usdt', ticker: 'USDT', name: 'Tether USD', precision: 6, balance: 10_000_000, protocol: 'SPARK' },
    ],
  },
  settings: { bitcoinUnit: 'sats', hideBalances: false },
  ...extra,
});

beforeEach(() => { mockState = stateWith(); mockLevel = 'advanced'; });

const navigation = () => ({ navigate: jest.fn(), goBack: jest.fn() });

test('one row per asset, with its value and where it lives; total matches the dashboard', () => {
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.getByLabelText('Bitcoin, 14,000 sats, about $14.00, on Bitcoin, Spark')).toBeTruthy();
  expect(screen.getByLabelText('Tether USD, 40 USDT, about $40.00, on RGB, Spark')).toBeTruthy();
  // 15,000 sats of bitcoin + $40 at $100,000 (40,000 sats).
  expect(screen.getByText('55000')).toBeTruthy();
  expect(screen.queryByText(/Supply|Precision|Total Tokens/)).toBeNull();
});

test('network chips narrow the list to what lives there', () => {
  const screen = render(<AssetsScreen navigation={navigation()} />);
  fireEvent.press(screen.getByLabelText('Show assets on Spark'));
  expect(screen.getByLabelText('Bitcoin, 5,000 sats, about $5.00, on Spark')).toBeTruthy();
  expect(screen.getByLabelText('Tether USD, 10 USDT, about $10.00, on Spark')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Show assets on RGB'));
  expect(screen.queryByLabelText(/^Bitcoin/)).toBeNull();
});

test('search finds by name or ticker', () => {
  const screen = render(<AssetsScreen navigation={navigation()} />);
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'teth');
  expect(screen.queryByLabelText(/^Bitcoin/)).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'zzz');
  expect(screen.getByText('No matching assets')).toBeTruthy();
});

test('a row opens the asset detail where most of it lives', () => {
  const nav = navigation();
  const screen = render(<AssetsScreen navigation={nav} />);
  fireEvent.press(screen.getByLabelText(/^Tether USD/));
  expect(nav.navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'rgb-usdt', isRGB: true, protocol: 'RGB', balance: { spendable: 30_000_000, offchain_outbound: 1 }, fiatValue: 30 }),
  });
  fireEvent.press(screen.getByLabelText(/^Bitcoin/));
  expect(nav.navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'BTC', balance: { spendable: 14_000 } }),
  });
});

test('Lite hides networks and the issue button', () => {
  mockLevel = 'lite';
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.queryByLabelText('Show assets on Spark')).toBeNull();
  expect(screen.queryByLabelText('Issue a new asset')).toBeNull();
  expect(screen.getByLabelText('Tether USD, 40 USDT, about $40.00')).toBeTruthy();
});

test('one add button in Advanced; pull to refresh asks the dashboard for fresh balances', () => {
  const emit = jest.fn();
  (DeviceEventEmitter as any).emit = emit;
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.getAllByLabelText('Issue a new asset')).toHaveLength(1);
  const scroll = screen.UNSAFE_getAllByType(require('react-native').ScrollView)[0];
  scroll.props.refreshControl.props.onRefresh();
  expect(emit).toHaveBeenCalledWith('rate.refreshBalance');
});
