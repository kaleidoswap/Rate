import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import DashboardScreen from './DashboardScreen';
import { initializeProtocolServices } from '../services/initializeServices';
import { protocolManager } from '../services/protocols';
import { saveBalanceSnapshot } from '../services/balanceSnapshot';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockState: any = { wallet: { activeWallet: null, btcPriceUSD: 0 }, node: {}, settings: { bitcoinUnit: 'sats' }, nostr: {} };
const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: (fn: any) => fn(mockState) }));
jest.mock('../store/hooks', () => ({ useAppSelector: (fn: any) => fn(mockState) }));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (fn: any) => require('react').useEffect(fn, [fn]),
}));
jest.mock('../services/initializeServices', () => ({ initializeProtocolServices: jest.fn() }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: jest.fn() }, rgbAccountAdapter: jest.fn(), rgbAccountProtocol: () => 'RGB_LN' }));
jest.mock('../store/slices/walletSlice', () => ({ setBtcBalance: (payload: any) => ({ type: 'balance', payload }) }));
jest.mock('../store/slices/assetsSlice', () => ({ setRgbAssets: (payload: any) => ({ type: 'assets', payload }) }));
jest.mock('../store/slices/nostrSlice', () => ({ loadNostrProfile: jest.fn() }));
jest.mock('../store/slices/settingsSlice', () => ({ selectDisclosureLevel: () => 'lite' }));
jest.mock('@kaleidorg/wallet-engine', () => ({ policyFor: () => ({}), aggregateForLite: () => ({ other: [] }) }));
jest.mock('../utils/bitcoinUnits', () => ({
  formatBitcoinAmount: String,
  useBitcoinConversion: () => ({ formatSatoshisToUSD: String }),
  useDisplayAmount: () => ({ format: () => ({ primary: '0', secondary: '$0', unitLabel: 'sats' }), cycle: jest.fn() }),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../components', () => ({
  BalanceCard: ({ loading, updating, byProtocol }: any) => {
    const { createElement: h, Fragment } = require('react');
    const { Text } = require('react-native');
    const accounts = Object.entries(byProtocol ?? {}).map(([k, b]: any) => `${k} ${b.total}`).join(', ');
    return h(Fragment, {}, h(Text, {}, loading ? 'Loading balance' : 'Balance ready'), updating ? h(Text, {}, 'Updating') : null,
      h(Text, {}, `Accounts: ${accounts || 'none'}`));
  },
  ActionButtons: () => null, AssetList: () => null, ChannelList: () => null, MainHeader: () => null,
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
    const adapter = {
      isConnected: () => true, getNodeInfo: jest.fn().mockResolvedValue({}),
      getBtcBalance: jest.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0, total: 0 }),
      listAssets: jest.fn().mockResolvedValue([]),
    };
    (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation(p => p === 'SPARK' ? adapter : undefined);
    (initializeProtocolServices as jest.Mock).mockResolvedValue({ results: new Map([['SPARK', { success: true }]]) });
    fireEvent.press(screen.getByText('Wallet connection unavailable. Tap to retry.'));
    await waitFor(() => expect(screen.getByText('Balance ready')).toBeTruthy());
    expect(initializeProtocolServices).toHaveBeenCalledTimes(2);
    expect(adapter.getBtcBalance).toHaveBeenCalled();
    expect(screen.queryByText('Balance unavailable')).toBeNull();
  });
});

describe('fast first balance', () => {
  const sparkSnapshot = { byProtocol: { SPARK: { confirmed: 1000, unconfirmed: 0, total: 1000 } }, assets: [], channels: [], btcPriceUSD: 0 };
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
    finishArkade({ confirmed: 300, unconfirmed: 0, total: 300 });
    await waitFor(() => expect(screen.getByText('Accounts: SPARK 500, ARKADE 300')).toBeTruthy());
  });
});
