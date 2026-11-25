import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import DashboardScreen from './DashboardScreen';
import { initializeProtocolServices } from '../services/initializeServices';
import { protocolManager } from '../services/protocols';
import { loadBalanceSnapshot, saveBalanceSnapshot } from '../services/balanceSnapshot';
import { requestBalanceRefresh } from '../services/balanceRefresh';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockState: any = { wallet: { activeWallet: null, btcPriceUSD: 0 }, assets: { rgbAssets: [] }, node: {}, settings: { bitcoinUnit: 'sats' }, nostr: {} };
const mockDispatch = jest.fn();
let mockLevel: 'lite' | 'advanced' = 'lite';
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: (fn: any) => fn(mockState) }));
jest.mock('../store/hooks', () => ({ useAppSelector: (fn: any) => fn(mockState), useAppDispatch: () => mockDispatch }));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (fn: any) => require('react').useEffect(fn, [fn]),
}));
jest.mock('../components/RecentActivityWidget', () => ({ RecentActivityWidget: () => null }));
jest.mock('../components/mind/InsightCards', () => ({
  InsightCards: () => require('react').createElement(require('react-native').Text, {}, 'Insights'),
}));
jest.mock('../services/initializeServices', () => ({ initializeProtocolServices: jest.fn() }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: jest.fn() }, rgbAccountAdapter: jest.fn(), rgbAccountProtocol: () => 'RGB_LN' }));
jest.mock('../store/slices/walletSlice', () => ({
  setBtcBalance: (payload: any) => ({ type: 'balance', payload }),
  setWalletPortfolio: (payload: any) => ({ type: 'portfolio', payload }),
}));
jest.mock('../store/slices/assetsSlice', () => ({
  setRgbAssets: (payload: any) => ({ type: 'assets', payload }),
  setProtocolAssets: (payload: any) => ({ type: 'protocolAssets', payload }),
}));
jest.mock('../store/slices/nostrSlice', () => ({ loadNostrProfile: jest.fn() }));
jest.mock('../store/slices/settingsSlice', () => ({ selectDisclosureLevel: () => mockLevel, setAssetHiddenPreference: jest.fn() }));
jest.mock('@kaleidorg/wallet-engine', () => ({ policyFor: (level: string) => ({ showNetworks: level === 'advanced' }), liteBucketOf: () => 'OTHER' }));
jest.mock('../utils/bitcoinUnits', () => ({
  formatBitcoinAmount: String,
  useBitcoinConversion: () => ({ formatSatoshisToUSD: String }),
  useDisplayAmount: () => ({ format: () => ({ primary: '0', secondary: '$0', unitLabel: 'sats' }), cycle: jest.fn() }),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../components', () => ({
  BalanceCard: ({ loading, updating, byProtocol, pendingAccounts }: any) => {
    const { createElement: h, Fragment } = require('react');
    const { Text } = require('react-native');
    const accounts = Object.entries(byProtocol ?? {}).map(([k, b]: any) => `${k} ${b.total}`).join(', ');
    return h(Fragment, {}, h(Text, {}, loading ? 'Loading balance' : 'Balance ready'), updating ? h(Text, {}, 'Updating') : null,
      h(Text, {}, `Accounts: ${accounts || 'none'}`), h(Text, {}, `Waiting: ${(pendingAccounts ?? []).join(', ')}`));
  },
  ActionButtons: () => null,
  AssetList: jest.requireActual('../components/AssetList').AssetList,
  SectionHeader: jest.requireActual('../components/SectionHeader').SectionHeader,
  ChannelList: () => null, MainHeader: ({ leftNode }: any) => leftNode ?? null,
}));

describe('dashboard connection recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.wallet.activeWallet = null;
    (protocolManager.getAdapterIfAvailable as jest.Mock).mockReturnValue(undefined);
    (initializeProtocolServices as jest.Mock).mockResolvedValue({ results: new Map() });
  });
  it('offers setup without making connection requests when no wallet exists', async () => {
    const navigate = jest.fn();
    const screen = render(<DashboardScreen navigation={{ navigate }} />);
    expect(screen.getByText('Set up your wallet')).toBeTruthy();
    expect(screen.queryByText('Loading balance')).toBeNull();
    expect(initializeProtocolServices).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Create wallet'));
    expect(navigate).toHaveBeenCalledWith('WalletSetup');
  });
  it('greets the user above their profile name', () => {
    mockState.nostr = { publicKey: 'pk', profile: { display_name: 'Alice' } };
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    const texts = screen.UNSAFE_getAllByType(require('react-native').Text).map((t: any) => String(t.props.children));
    const nameAt = texts.indexOf('Alice');
    expect(nameAt).toBeGreaterThan(0);
    expect(texts[nameAt - 1]).toMatch(/^(Still up|Good|Hi|Morning|Rise|Hey|Evening|Welcome|Winding)/);
    mockState.nostr = {};
  });
  it('offers restore when a wallet record has no accessible seed', () => {
    mockState.wallet.activeWallet = { id: 1 };
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    expect(screen.getByText('Restore your wallet')).toBeTruthy();
    expect(initializeProtocolServices).not.toHaveBeenCalled();
  });
  it('ends loading after connection failure and reconnects on retry', async () => {
    mockState.wallet.activeWallet = { id: 1, encrypted_mnemonic: 'test-only-seed' };
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(screen.getByText('Balance unavailable')).toBeTruthy());
    expect(screen.queryByText('Loading balance')).toBeNull();
    expect(screen.queryByText('Assets')).toBeNull();
    const adapter = {
      isConnected: () => true, getNodeInfo: jest.fn().mockResolvedValue({}),
      getBtcBalance: jest.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0, total: 0 }),
      listAssets: jest.fn().mockResolvedValue([]),
    };
    (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation(p => p === 'SPARK' ? adapter : undefined);
    (initializeProtocolServices as jest.Mock).mockResolvedValue({ results: new Map([['SPARK', { success: true }]]) });
    fireEvent.press(screen.getByLabelText('Retry wallet connection'));
    await waitFor(() => expect(screen.getByText('Balance ready')).toBeTruthy());
    expect(initializeProtocolServices).toHaveBeenCalledTimes(2);
    expect(adapter.getBtcBalance).toHaveBeenCalled();
    expect(screen.getByText('Assets')).toBeTruthy();
    expect(screen.queryByText('Balance unavailable')).toBeNull();
  });
  it('drops RGB on this phone from the offline banner once it connects after startup', async () => {
    mockState.wallet.activeWallet = { id: 1, encrypted_mnemonic: 'test-only-seed' };
    let rgbL1Connected = false;
    const spark = {
      isConnected: () => true, getNodeInfo: jest.fn().mockResolvedValue({}),
      getBtcBalance: jest.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0, total: 0 }),
      listAssets: jest.fn().mockResolvedValue([]),
    };
    const rgbL1 = { ...spark, isConnected: () => rgbL1Connected };
    (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation(p => (p === 'SPARK' ? spark : p === 'RGB_L1' ? rgbL1 : undefined));
    (initializeProtocolServices as jest.Mock).mockResolvedValue({ results: new Map<string, any>([
      ['SPARK', { success: true }], ['RGB_L1', { success: false, error: "Couldn't restore your RGB backup (timeout)." }],
    ]) });
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    const banner = /^RGB on this phone is offline/;
    await waitFor(() => expect(screen.getByText(banner)).toBeTruthy());
    rgbL1Connected = true;
    (initializeProtocolServices as jest.Mock).mockResolvedValue({ results: new Map([['SPARK', { success: true }], ['RGB_L1', { success: true }]]) });
    fireEvent.press(screen.getByText(banner));
    await waitFor(() => expect(screen.queryByText(banner)).toBeNull());
    expect(initializeProtocolServices).toHaveBeenCalledTimes(2);
  });
});

describe('fast first balance', () => {
  const sparkSnapshot = { byProtocol: { SPARK: { confirmed: 1000, unconfirmed: 0, total: 1000 } }, assets: [], channels: [], btcPriceUSD: 0, testNetworks: {} };
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (protocolManager.getAdapterIfAvailable as jest.Mock).mockReturnValue(undefined);
  });

  it('reads connected accounts while a slow one is still connecting', async () => {
    mockState.wallet.activeWallet = { id: 1, created_at: 5, encrypted_mnemonic: 'test-only-seed' };
    const spark = {
      isConnected: () => true, getNodeInfo: jest.fn().mockResolvedValue({}),
      getBtcBalance: jest.fn().mockResolvedValue({ confirmed: 2500, unconfirmed: 0, total: 2500 }),
      listAssets: jest.fn().mockResolvedValue([]),
    };
    (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation(p => p === 'SPARK' ? spark : undefined);
    // An unreachable node keeps the startup from settling.
    (initializeProtocolServices as jest.Mock).mockReturnValue(new Promise(() => {}));
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(screen.getByText('Accounts: SPARK 2500')).toBeTruthy(), { timeout: 5000 });
    expect(spark.getBtcBalance).toHaveBeenCalled();
    expect(screen.getByText('Updating')).toBeTruthy();
    screen.unmount();
  });

  it('shows the last balance at once while the accounts reconnect', async () => {
    mockState.wallet.activeWallet = { id: 1, created_at: 5, encrypted_mnemonic: 'test-only-seed' };
    await saveBalanceSnapshot(mockState.wallet.activeWallet, sparkSnapshot);
    (initializeProtocolServices as jest.Mock).mockReturnValue(new Promise(() => {}));
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(screen.getByText('Accounts: SPARK 1000')).toBeTruthy());
    expect(screen.getByText('Updating')).toBeTruthy();
    expect(screen.queryByText('Loading balance')).toBeNull();
  });

  it('never shows another wallet\'s last balance', async () => {
    await saveBalanceSnapshot({ id: 1, created_at: 5 }, sparkSnapshot);
    mockState.wallet.activeWallet = { id: 2, created_at: 9, encrypted_mnemonic: 'test-only-seed' };
    (initializeProtocolServices as jest.Mock).mockReturnValue(new Promise(() => {}));
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Accounts: none')).toBeTruthy();
  });

  it('shows each account as soon as it answers', async () => {
    mockState.wallet.activeWallet = { id: 3, created_at: 1, encrypted_mnemonic: 'test-only-seed' };
    let finishArkade: (v: any) => void = () => {};
    const adapter = (getBtcBalance: () => Promise<any>) => ({
      isConnected: () => true, getNodeInfo: jest.fn().mockResolvedValue({}), getBtcBalance, listAssets: jest.fn().mockResolvedValue([]),
    });
    const spark = adapter(() => Promise.resolve({ confirmed: 500, unconfirmed: 0, total: 500 }));
    const arkade = adapter(() => new Promise((r) => { finishArkade = r; }));
    (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation(p => (p === 'SPARK' ? spark : p === 'ARKADE' ? arkade : undefined));
    (initializeProtocolServices as jest.Mock).mockResolvedValue({ results: new Map([['SPARK', { success: true }], ['ARKADE', { success: true }]]) });
    const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(screen.getByText('Accounts: SPARK 500')).toBeTruthy());
    expect(screen.getByText('Updating')).toBeTruthy();
    expect(screen.getByText('Waiting: Arkade')).toBeTruthy();
    finishArkade({ confirmed: 300, unconfirmed: 0, total: 300 });
    await waitFor(() => expect(screen.getByText('Accounts: SPARK 500, ARKADE 300')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('Updating')).toBeNull());
    screen.unmount();
  });
});

test('shows the cached portfolio inline and opens details on the selected account', async () => {
  mockLevel = 'advanced';
  const wallet = { id: 9, created_at: 1, encrypted_mnemonic: 'test-only-seed' };
  mockState.wallet.activeWallet = wallet;
  (initializeProtocolServices as jest.Mock).mockReturnValue(new Promise(() => {}));
  (protocolManager.getAdapterIfAvailable as jest.Mock).mockReturnValue(undefined);
  await saveBalanceSnapshot(wallet, {
    byProtocol: { SPARK: { confirmed: 10_000, unconfirmed: 0, total: 10_000 } },
    assets: [
      { asset_id: 'first-usdt', ticker: 'USDT', name: 'Tether USD', balance: 30_000_000, precision: 6, protocol: 'RGB' },
      { asset_id: 'second-usdt', ticker: 'USDT', name: 'Tether USD', balance: 10_000_000, precision: 6, protocol: 'SPARK' },
    ],
    channels: [],
    btcPriceUSD: 100_000,
    testNetworks: {},
  });
  const navigate = jest.fn();
  const screen = render(<DashboardScreen navigation={{ navigate, getParent: () => ({ navigate }) }} />);
  await waitFor(() => expect(screen.getByLabelText(/^Tether USD, 30 USDT, on RGB/)).toBeTruthy());
  expect(screen.getByLabelText(/^Tether USD, 10 USDT, on Spark/)).toBeTruthy();
  expect(screen.getAllByText(/^(Balance ready|Assets|Insights)$/).map(text => text.props.children))
    .toEqual(['Balance ready', 'Assets', 'Insights']);
  expect(screen.queryByLabelText('Search assets')).toBeNull();
  expect(screen.queryByLabelText('Spark')).toBeNull();
  fireEvent.press(screen.getByLabelText('Asset settings'));
  fireEvent.changeText(screen.getByLabelText('Search assets'), 'tether');
  fireEvent.press(screen.getByLabelText('Spark'));
  fireEvent.press(screen.getByText('Done'));
  expect(screen.queryByLabelText(/^Bitcoin,/)).toBeNull();
  fireEvent.press(screen.getByLabelText(/^Tether USD, 10 USDT/));
  expect(navigate).toHaveBeenCalledWith('AssetDetail', {
    asset: expect.objectContaining({ asset_id: 'second-usdt', protocol: 'SPARK', isRGB: false }),
  });
  fireEvent.press(screen.getByLabelText('Open Assets'));
  expect(navigate).toHaveBeenCalledWith('Assets');
  screen.unmount();
  mockLevel = 'lite';
});

test('a failed asset read preserves the displayed and saved row, while a successful empty read clears it', async () => {
  const wallet = { id: 12, created_at: 7, encrypted_mnemonic: 'test-only-seed' };
  mockState.wallet.activeWallet = wallet;
  await saveBalanceSnapshot(wallet, {
    byProtocol: { SPARK: { confirmed: 10_000, unconfirmed: 0, total: 10_000 } },
    assets: [{ asset_id: 'saved', ticker: 'TOKEN', name: 'Saved token', precision: 0, protocol: 'SPARK', balance: 1000 }],
    channels: [], btcPriceUSD: 0, testNetworks: {},
  });
  const before = await loadBalanceSnapshot(wallet);
  const spark = {
    isConnected: () => true,
    getBtcBalance: jest.fn().mockResolvedValue({ confirmed: 11_000, unconfirmed: 0, total: 11_000 }),
    listAssets: jest.fn().mockRejectedValue(new Error('offline')),
  };
  (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation(p => p === 'SPARK' ? spark : undefined);
  (initializeProtocolServices as jest.Mock).mockResolvedValue({ results: new Map([['SPARK', { success: true }]]) });
  const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
  await waitFor(() => expect(screen.getByText('Could not refresh SPARK assets.')).toBeTruthy());
  expect(screen.getByLabelText(/^Saved token, 1,000 TOKEN, on Spark/)).toBeTruthy();
  expect(await loadBalanceSnapshot(wallet)).toEqual(before);
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'portfolio', payload: expect.objectContaining({
    walletKey: '12:7', assets: before?.assets, status: 'partial', updatedAt: before?.savedAt,
  }) }));

  spark.listAssets.mockResolvedValue([]);
  const first = requestBalanceRefresh('12:7');
  const second = requestBalanceRefresh('12:7');
  expect(first).toBe(second);
  await act(async () => { expect(await first).toBe('complete'); });
  expect(spark.listAssets).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText(/^Saved token/)).toBeNull();
  expect((await loadBalanceSnapshot(wallet))?.assets).toEqual([]);
});

test('an offline legacy snapshot excludes configured Signet and unidentified balances from the mainnet total', async () => {
  const wallet = { id: 17, created_at: 1, encrypted_mnemonic: 'test-only-seed', networks: [
    { type: 'arkade', enabled: true, config: '{"network":"signet"}' },
  ] };
  mockState.wallet.activeWallet = wallet;
  (initializeProtocolServices as jest.Mock).mockReturnValue(new Promise(() => {}));
  (protocolManager.getAdapterIfAvailable as jest.Mock).mockReturnValue(undefined);
  await saveBalanceSnapshot(wallet, {
    byProtocol: {
      ARKADE: { confirmed: 100, unconfirmed: 0, total: 100 },
      SPARK: { confirmed: 200, unconfirmed: 0, total: 200 },
    },
    assets: [], channels: [], btcPriceUSD: 100_000,
  });
  const screen = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
  await screen.findByText('Accounts: ARKADE 100');
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'portfolio', payload: expect.objectContaining({
    walletKey: '17:1', status: 'cached', btcBalance: expect.objectContaining({
      summary: { total: 0, available: 0, unavailable: 0, test: 100 },
      networkChains: expect.objectContaining({ arkade: 'Mutinynet' }),
    }),
  }) }));
});
