import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import DashboardScreen from './DashboardScreen';
import { initializeProtocolServices } from '../services/initializeServices';
import { protocolManager } from '../services/protocols';

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
jest.mock('../components', () => ({
  BalanceCard: ({ loading }: any) => require('react').createElement(require('react-native').Text, {}, loading ? 'Loading balance' : 'Balance ready'),
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
