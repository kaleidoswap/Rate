import React from 'react';
import { DeviceEventEmitter } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import AssetsScreen from './AssetsScreen';
import { USDB_TOKEN_ADDRESS } from '../utils/flashnet';

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
const mockOpenIssue = jest.fn();
let mockRgb: any = { protocolName: 'RGB_L1', isConnected: () => true, issueAssetNia: jest.fn() };
jest.mock('../components/rgb/RgbWalletTools', () => ({ useRgbWalletSheets: () => ({ sheets: null, openIssue: mockOpenIssue, openUtxos: jest.fn() }) }));
jest.mock('../services/protocols', () => ({ rgbAccountAdapter: () => mockRgb }));

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
      { asset_id: USDB_TOKEN_ADDRESS.mainnet, ticker: 'USDB', name: 'Spark USD Balance', precision: 6, balance: 20_000_000, protocol: 'SPARK' },
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
  expect(screen.getByLabelText('Tether USD, 30 USDT, on RGB, asset ID rgb-usdt')).toBeTruthy();
  expect(screen.getByLabelText('Tether USD, 10 USDT, on Spark, asset ID spark-usdt')).toBeTruthy();
  expect(screen.getByLabelText('Spark USD Balance, 20 USDB, about $20.00, on Spark')).toBeTruthy();
  // 15,000 sats of bitcoin plus $20 of verified USDB.
  expect(screen.getByText('35000')).toBeTruthy();
  expect(screen.queryByText(/Supply|Precision|Total Tokens/)).toBeNull();
});

test('network chips narrow the list to what lives there', () => {
  const screen = render(<AssetsScreen navigation={navigation()} />);
  fireEvent.press(screen.getByLabelText('Show assets on Spark'));
  expect(screen.getByLabelText('Bitcoin, 5,000 sats, about $5.00, on Spark')).toBeTruthy();
  expect(screen.getByLabelText(/^Tether USD, 10 USDT, on Spark/)).toBeTruthy();
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

test('an exact ID search opens the corresponding contract', () => {
  const nav = navigation();
  const screen = render(<AssetsScreen navigation={nav} />);
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'rgb-usdt');
  fireEvent.press(screen.getByLabelText(/^Tether USD/));
  expect(nav.navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'rgb-usdt', isRGB: true, protocol: 'RGB', balance: { spendable: 30_000_000, offchain_outbound: 1 }, fiatValue: undefined }),
  });
  fireEvent.press(screen.getByLabelText('Clear search'));
  fireEvent.press(screen.getByLabelText(/^Bitcoin/));
  expect(nav.navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'BTC', balance: { spendable: 14_000 } }),
  });
});

test('a test network has no fiat value and its Bitcoin detail keeps the selected scope', () => {
  Object.assign(mockState.wallet.btcBalance, {
    networks: { onchain: 10_000, spark: 100_000 },
    networkChains: { spark: 'Regtest' },
    mainnetNetworks: { onchain: 10_000 },
    summary: { total: 10_000, available: 10_000, unavailable: 0, test: 100_000 },
  });
  const nav = navigation();
  const screen = render(<AssetsScreen navigation={nav} />);
  expect(screen.getByText('10000')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Show assets on Spark'));
  fireEvent.press(screen.getByLabelText('Bitcoin, 100,000 sats, on Spark · Regtest (test)'));
  expect(nav.navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'BTC', btcNetwork: 'spark', balance: { spendable: 100_000 }, fiatValue: undefined }),
  });
});

test('Lite hides networks and the issue button', () => {
  mockLevel = 'lite';
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.queryByLabelText('Show assets on Spark')).toBeNull();
  expect(screen.queryByLabelText('Issue a new asset')).toBeNull();
  expect(screen.getByLabelText('Tether USD, 30 USDT, asset ID rgb-usdt')).toBeTruthy();
});

test('one add button in Advanced; pull to refresh asks the dashboard for fresh balances', () => {
  const emit = jest.fn();
  (DeviceEventEmitter as any).emit = emit;
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.getAllByLabelText('Issue a new asset')).toHaveLength(1);
  fireEvent.press(screen.getByLabelText('Issue a new asset'));
  expect(mockOpenIssue).toHaveBeenCalled();
  const scroll = screen.UNSAFE_getAllByType(require('react-native').ScrollView)[0];
  scroll.props.refreshControl.props.onRefresh();
  expect(emit).toHaveBeenCalledWith('rate.refreshBalance');
});

test('no issue button when the RGB account can’t issue (the node over NWC)', () => {
  mockLevel = 'advanced';
  const saved = mockRgb;
  mockRgb = { protocolName: 'RGB_LN', isConnected: () => true, walletType: () => 'rln', hasRlnMethod: () => true };
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.queryByLabelText('Issue a new asset')).toBeNull();
  mockRgb = saved;
});
