import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import AssetDetailScreen from './AssetDetailScreen';

let mockAssets: any[] = [];
let mockLevel = 'lite';
const mockWatch = jest.fn();
const mockOpenUtxos = jest.fn();
jest.mock('../store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (f: any) => f({ assets: { rgbAssets: mockAssets }, settings: { disclosureLevel: mockLevel } }),
}));
jest.mock('../hooks/useRgbTransferWatch', () => ({ useRgbTransferWatch: (args: any) => { mockWatch(args); return []; } }));
jest.mock('../components/rgb/RgbWalletTools', () => ({ useRgbWalletSheets: () => ({ sheets: null, openUtxos: mockOpenUtxos, openIssue: jest.fn() }) }));
jest.mock('../store/slices/assetsSlice', () => ({ refreshRgbAssets: () => ({ type: 'refreshRgbAssets' }) }));
const mockRefreshTransfers = jest.fn(async () => undefined);
let mockMetadata: any = null;
let mockRights = 0;
jest.mock('../services/rgbWallet', () => ({
  refreshRgbTransfers: () => mockRefreshTransfers(),
  getRgbAssetMetadata: async () => mockMetadata,
  rgbInflationRights: async () => mockRights,
}));
let mockCaps: any = {};
jest.mock('../services/protocols', () => ({ rgbAccountAdapter: () => ({ protocolName: 'RGB_L1', isConnected: () => true, listUnspents: jest.fn(), account: { capabilities: () => mockCaps } }) }));
jest.mock('../components/rgb/InflateAssetSheet', () => ({ InflateAssetSheet: 'InflateAssetSheet' }));
jest.mock('../store/slices/walletSlice', () => ({ loadBtcBalance: () => ({ type: 'loadBtcBalance' }) }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader' }));
jest.mock('../components/RecentActivityWidget', () => ({ RecentActivityWidget: 'RecentActivityWidget' }));

const usdt = {
  asset_id: 'rgb:usdt-id-0123456789abcdefghijkl', ticker: 'USDT', name: 'Tether USD', precision: 6, issued_supply: 1_000_000_000_000,
  protocol: 'RGB' as const, isRGB: true, balance: { settled: 40_500_000, future: 50_500_000, spendable: 40_500_000, offchain_outbound: 2_000_000 },
};
const open = (asset: any, navigation: any = { navigate: jest.fn(), goBack: jest.fn() }) =>
  ({ navigation, screen: render(<AssetDetailScreen navigation={navigation} route={{ params: { asset } }} />) });

beforeEach(() => { mockAssets = []; mockLevel = 'lite'; mockWatch.mockClear(); mockMetadata = null; mockRights = 0; mockCaps = {}; });

test('shows the balance in the asset unit, its breakdown and details', () => {
  const { screen } = open(usdt);
  expect(screen.getByLabelText('Balance 40.5 USDT')).toBeTruthy();
  expect(screen.getByText('+10 USDT incoming')).toBeTruthy();   // incoming = future − settled, once (in the hero)
  expect(screen.getByText('2 USDT')).toBeTruthy();              // in Lightning channels
  expect(screen.getByText('1,000,000 USDT')).toBeTruthy();      // issued supply, formatted
  expect(screen.getByText('rgb:usdt-i…efghijkl')).toBeTruthy();   // asset id, middle-truncated
  // The asset's own history sits under the actions.
  expect(screen.UNSAFE_getByType('RecentActivityWidget' as any).props).toEqual(expect.objectContaining({ assetId: usdt.asset_id, assetTicker: 'USDT', title: 'History' }));
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

test('an RGB asset’s transfers are watched while open, and its history reloads when one moves', () => {
  const { screen } = open(usdt);
  const args = mockWatch.mock.calls.at(-1)[0];
  expect(args).toEqual(expect.objectContaining({ assetId: usdt.asset_id, enabled: true }));
  expect(screen.UNSAFE_getByType('RecentActivityWidget' as any).props.refreshKey).toBe(0);
  const { act } = require('@testing-library/react-native');
  act(() => args.onChange());
  expect(screen.UNSAFE_getByType('RecentActivityWidget' as any).props.refreshKey).toBe(1);
});

test('bitcoin and Spark tokens are not watched as RGB', () => {
  open({ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false, balance: 1 });
  expect(mockWatch.mock.calls.at(-1)[0].enabled).toBe(false);
  open({ asset_id: 'spark-usdb', ticker: 'USDB', name: 'USDB', isRGB: false, protocol: 'SPARK', balance: 1 });
  expect(mockWatch.mock.calls.at(-1)[0].enabled).toBe(false);
});

test('Advanced opens the RGB account’s UTXOs from an RGB asset; Lite does not offer it', () => {
  expect(open(usdt).screen.queryByLabelText('UTXOs')).toBeNull();
  mockLevel = 'advanced';
  const { screen } = open(usdt);
  fireEvent.press(screen.getByLabelText('UTXOs'));
  expect(mockOpenUtxos).toHaveBeenCalled();
});

test('pulling an RGB asset moves its transfers forward and reloads its history', async () => {
  const { act } = require('@testing-library/react-native');
  const { screen } = open(usdt);
  const scroll = screen.UNSAFE_getAllByType(require('react-native').ScrollView)[0];
  await act(async () => { await scroll.props.refreshControl.props.onRefresh(); });
  expect(mockRefreshTransfers).toHaveBeenCalled();
  expect(screen.UNSAFE_getByType('RecentActivityWidget' as any).props.refreshKey).toBe(1);
});

test('shows the RGB contract: schema, supply, issuance date, description and its image', async () => {
  mockMetadata = { schema: 'CFA', name: 'Genesis Art', ticker: 'Genesis Art', precision: 0, issuedSupply: 10, timestamp: 1_700_000_000,
    details: 'Edition of ten', media: { uri: 'file:///media/abc', mime: 'image/png', isImage: true } };
  const art = { asset_id: 'rgb:art-0123456789abcdefghijklmnop', ticker: 'Genesis Art', name: 'Genesis Art', precision: 0, protocol: 'RGB', isRGB: true, balance: 10 };
  const { screen } = open(art);
  expect(await screen.findByText('Collectible (CFA)')).toBeTruthy();
  expect(screen.getByText('Issued supply')).toBeTruthy();
  expect(screen.getByText('Issued')).toBeTruthy();
  expect(screen.getByText('Edition of ten')).toBeTruthy();
  expect(screen.getByText('Contract ID')).toBeTruthy();
  expect(screen.getByLabelText('Genesis Art image').props.source).toEqual({ uri: 'file:///media/abc' });
  expect(screen.queryByText('Ticker')).toBeNull(); // the same as the unit already shown
});

test('Advanced offers to issue more of an IFA asset the wallet holds inflation rights for', async () => {
  const { act } = require('@testing-library/react-native');
  mockMetadata = { schema: 'IFA', ticker: 'INF', precision: 2, issuedSupply: 1000, maxSupply: 5000 };
  mockRights = 4000;
  mockCaps = { inflate: true };
  const inf = { asset_id: 'rgb:inf', ticker: 'INF', name: 'Inflatable', precision: 2, protocol: 'RGB', isRGB: true, balance: 1000 };
  const lite = open(inf).screen;
  expect(await lite.findByText('Maximum supply')).toBeTruthy();
  expect(lite.queryByLabelText('Issue more INF')).toBeNull();
  mockLevel = 'advanced';
  const { screen } = open(inf);
  fireEvent.press(await screen.findByLabelText('Issue more INF'));
  expect(screen.getByText('Issue more · up to 40 INF')).toBeTruthy();
  await act(async () => undefined);
  expect(screen.UNSAFE_getByType('InflateAssetSheet' as any).props).toEqual(expect.objectContaining({ visible: true, rights: 4000 }));
});
