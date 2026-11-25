import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AssetsScreen from './AssetsScreen';
import { USDB_TOKEN_ADDRESS } from '../utils/flashnet';
import settingsReducer from '../store/slices/settingsSlice';
import { registerBalanceRefresh, type BalanceRefreshResult } from '../services/balanceRefresh';

let mockState: any;
let mockLevel: 'lite' | 'advanced' = 'advanced';
const mockDispatch = jest.fn(action => { mockState.settings = settingsReducer(mockState.settings, action); });
jest.mock('react-redux', () => ({ useSelector: (fn: any) => fn(mockState), useDispatch: () => mockDispatch }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
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
    activeWallet: { id: 3, created_at: 1 },
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
  expect(screen.queryByLabelText('Search assets')).toBeNull();
  expect(screen.queryByLabelText('Spark')).toBeNull();
  expect(screen.queryByText(/Supply|Precision|Total Tokens/)).toBeNull();
});

test('network controls in settings narrow the list to what lives there', () => {
  const screen = render(<AssetsScreen navigation={navigation()} />);
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.press(screen.getByLabelText('Spark'));
  fireEvent.press(screen.getByText('Done'));
  expect(screen.getByLabelText('Bitcoin, 5,000 sats, about $5.00, on Spark')).toBeTruthy();
  expect(screen.getByLabelText(/^Tether USD, 10 USDT, on Spark/)).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.press(screen.getByLabelText('RGB'));
  fireEvent.press(screen.getByText('Done'));
  expect(screen.queryByLabelText(/^Bitcoin/)).toBeNull();
});

test('search finds by name or ticker', () => {
  const screen = render(<AssetsScreen navigation={navigation()} />);
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'teth');
  fireEvent.press(screen.getByText('Done'));
  expect(screen.queryByLabelText(/^Bitcoin/)).toBeNull();
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'zzz');
  fireEvent.press(screen.getByText('Done'));
  expect(screen.getByText('No matching assets')).toBeTruthy();
});

test('an exact ID search opens the corresponding contract', () => {
  const nav = navigation();
  const screen = render(<AssetsScreen navigation={nav} />);
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'rgb-usdt');
  fireEvent.press(screen.getByText('Done'));
  fireEvent.press(screen.getByLabelText(/^Tether USD/));
  expect(nav.navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'rgb-usdt', isRGB: true, protocol: 'RGB', balance: { spendable: 30_000_000, offchain_outbound: 1 }, fiatValue: undefined }),
  });
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.changeText(screen.getByLabelText('Search assets'), '');
  fireEvent.press(screen.getByText('Done'));
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
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.press(screen.getByLabelText('Spark'));
  fireEvent.press(screen.getByText('Done'));
  fireEvent.press(screen.getByLabelText('Bitcoin, 100,000 sats, on Spark · Regtest (test)'));
  expect(nav.navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'BTC', btcNetwork: 'spark', balance: { spendable: 100_000 }, fiatValue: undefined }),
  });
});

test('Lite shows networks on rows and keeps issue unavailable', () => {
  mockLevel = 'lite';
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.queryByLabelText('Search assets')).toBeNull();
  expect(screen.queryByLabelText('Issue a new asset')).toBeNull();
  expect(screen.getByLabelText('Tether USD, 30 USDT, on RGB, asset ID rgb-usdt')).toBeTruthy();
});

test('remembers a hidden contract and keeps Asset settings available to show it again', () => {
  const nav = navigation();
  const screen = render(<AssetsScreen navigation={nav} />);
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent(screen.getByLabelText('Show asset Tether USD, RGB, rgb-usdt'), 'valueChange', false);
  fireEvent.press(screen.getByText('Done'));
  expect(screen.queryByLabelText(/^Tether USD, 30 USDT/)).toBeNull();
  expect(screen.getByLabelText(/^Tether USD, 10 USDT, on Spark/)).toBeTruthy();
  screen.unmount();

  const reopened = render(<AssetsScreen navigation={nav} />);
  expect(reopened.queryByLabelText(/^Tether USD, 30 USDT/)).toBeNull();
  fireEvent.press(reopened.getByLabelText('Asset settings'));
  expect(reopened.getByLabelText('Show asset Tether USD, RGB, rgb-usdt').props.value).toBe(false);
  fireEvent(reopened.getByLabelText('Show asset Tether USD, RGB, rgb-usdt'), 'valueChange', true);
  fireEvent.press(reopened.getByText('Done'));
  expect(reopened.getByLabelText(/^Tether USD, 30 USDT, on RGB/)).toBeTruthy();
});

test('every row can be hidden and the empty state still opens settings', () => {
  mockState.settings.hiddenAssetKeysByWallet = { 3: [
    'BTC', 'asset:rgb:rgb-usdt', 'asset:spark:spark-usdt', `asset:spark:${USDB_TOKEN_ADDRESS.mainnet}`,
  ] };
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.getByText('Assets are hidden')).toBeTruthy();
  expect(screen.getByText('35000')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Edit asset settings'));
  expect(screen.getByLabelText('Show asset Bitcoin, Bitcoin, Spark').props.value).toBe(false);
});

test('one add button in Advanced; pull to refresh waits for the actual result', async () => {
  let finish!: (result: BalanceRefreshResult) => void;
  const refresh = jest.fn(() => new Promise<BalanceRefreshResult>(resolve => { finish = resolve; }));
  const off = registerBalanceRefresh('3:1', refresh);
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.getAllByLabelText('Issue a new asset')).toHaveLength(1);
  fireEvent.press(screen.getByLabelText('Issue a new asset'));
  expect(mockOpenIssue).toHaveBeenCalled();
  const control = () => screen.UNSAFE_getAllByType(require('react-native').ScrollView)[0].props.refreshControl.props;
  act(() => { void control().onRefresh(); });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(control().refreshing).toBe(true);
  await act(async () => finish('partial'));
  await waitFor(() => expect(control().refreshing).toBe(false));
  expect(screen.getByText('Some balances could not be refreshed.')).toBeTruthy();
  off();
});

test('shows the same cached portfolio with its status, and never shows it after a wallet switch', () => {
  mockState.wallet.portfolio = {
    walletKey: '3:1', btcBalance: mockState.wallet.btcBalance,
    assets: mockState.assets.rgbAssets, btcPriceUSD: 100_000, updatedAt: 1000, status: 'cached',
  };
  mockState.wallet.btcBalance = null;
  mockState.assets.rgbAssets = [];
  const nav = navigation();
  const screen = render(<AssetsScreen navigation={nav} />);
  expect(screen.getByLabelText(/^Tether USD, 30 USDT/)).toBeTruthy();
  expect(screen.getByText(/^Showing the last known balances\. Last updated/)).toBeTruthy();
  mockState.wallet.activeWallet = { id: 5, created_at: 1 };
  screen.rerender(<AssetsScreen navigation={nav} />);
  expect(screen.queryByLabelText(/^Tether USD/)).toBeNull();
  expect(screen.getByLabelText('Total balance unavailable')).toBeTruthy();
});

test('no issue button when the RGB account can’t issue (the node over NWC)', () => {
  mockLevel = 'advanced';
  const saved = mockRgb;
  mockRgb = { protocolName: 'RGB_LN', isConnected: () => true, walletType: () => 'rln', hasRlnMethod: () => true };
  const screen = render(<AssetsScreen navigation={navigation()} />);
  expect(screen.queryByLabelText('Issue a new asset')).toBeNull();
  mockRgb = saved;
});
