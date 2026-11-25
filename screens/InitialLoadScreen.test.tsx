import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import InitialLoadScreen from './InitialLoadScreen';

const mockWallet = { id: 7, encrypted_mnemonic: 'test-only fixture' };
const mockDatabase = {
  initializeDatabase: jest.fn(),
  getActiveWallet: jest.fn(),
  getAllWallets: jest.fn(),
  setActiveWallet: jest.fn(),
};
const mockDispatch = jest.fn();
const mockPrepareBalanceSnapshot = jest.fn();

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => mockDatabase } }));
jest.mock('../store/slices/walletSlice', () => ({
  setActiveWallet: (wallet: unknown) => ({ type: 'wallet/setActiveWallet', payload: wallet }),
  setInitialized: (value: boolean) => ({ type: 'wallet/setInitialized', payload: value }),
  setUnlocked: (value: boolean) => ({ type: 'wallet/setUnlocked', payload: value }),
}));
jest.mock('../services/initializeServices', () => ({
  autoRestoreNostrConnection: async () => {},
}));
jest.mock('../services/balanceSnapshot', () => ({ prepareBalanceSnapshot: (wallet: unknown) => mockPrepareBalanceSnapshot(wallet) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockDatabase.initializeDatabase.mockResolvedValue(undefined);
  mockDatabase.getActiveWallet.mockResolvedValue(mockWallet);
  mockDatabase.getAllWallets.mockResolvedValue([]);
  mockDatabase.setActiveWallet.mockResolvedValue(undefined);
});

it('offers a retry after a database failure and opens the saved wallet after it recovers', async () => {
  mockDatabase.initializeDatabase.mockRejectedValueOnce(new Error('database unavailable'));
  const navigation = { replace: jest.fn() };
  const screen = render(<InitialLoadScreen navigation={navigation} />);
  expect(screen.getByRole('progressbar')).toBeTruthy();
  const retry = await screen.findByLabelText('Try again');
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(mockDatabase.getAllWallets).not.toHaveBeenCalled();

  fireEvent.press(retry);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Dashboard'));
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'wallet/setActiveWallet', payload: mockWallet });
  expect(mockPrepareBalanceSnapshot).toHaveBeenCalledTimes(1);
  expect(mockPrepareBalanceSnapshot).toHaveBeenCalledWith(mockWallet);
});

it('opens setup only after successfully reading an empty wallet list', async () => {
  mockDatabase.getActiveWallet.mockResolvedValue(null);
  mockDatabase.getAllWallets.mockRejectedValueOnce(new Error('wallet list unavailable'));
  const navigation = { replace: jest.fn() };
  const screen = render(<InitialLoadScreen navigation={navigation} />);
  const retry = await screen.findByLabelText('Try again');
  expect(navigation.replace).not.toHaveBeenCalled();

  fireEvent.press(retry);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('WalletSetup'));
  expect(mockDatabase.getAllWallets).toHaveBeenCalledTimes(2);
  expect(mockPrepareBalanceSnapshot).not.toHaveBeenCalled();
});

it.each([
  { id: mockWallet.id },
  null,
])('offers a retry when an existing wallet cannot be opened (%j)', async (wallet) => {
  mockDatabase.getActiveWallet.mockResolvedValueOnce(null).mockResolvedValueOnce(wallet);
  mockDatabase.getAllWallets.mockResolvedValue([{ id: mockWallet.id }]);
  const navigation = { replace: jest.fn() };
  const screen = render(<InitialLoadScreen navigation={navigation} />);
  await screen.findByLabelText('Try again');

  expect(mockDatabase.setActiveWallet).toHaveBeenCalledWith(mockWallet.id);
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockPrepareBalanceSnapshot).not.toHaveBeenCalled();
});
