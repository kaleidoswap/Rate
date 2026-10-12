import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import LightningAddressScreen from './LightningAddressScreen';
const mockRelease = jest.fn();
jest.mock('../store/hooks', () => ({ useAppDispatch: () => jest.fn(), useAppSelector: (fn: any) => fn({ wallet: { activeWallet: { id: 1 } }, nostr: {}, settings: { transactionNotifications: true } }) }));
jest.mock('../store/slices/nostrSlice', () => ({ updateNostrProfile: jest.fn(), restoreNostrConnection: jest.fn() }));
jest.mock('../services/paymentNotifications', () => ({ syncPaymentPush: jest.fn() }));
jest.mock('../services/kaleidoswapMe', () => ({
  KALEIDOSWAP_ME_DOMAIN: 'kaleidoswap.me', sparkSigner: () => ({}), normalizeName: (s: string) => s,
  nameProblem: () => null, checkName: jest.fn(), claimHandle: jest.fn(), releaseHandle: (...a: any[]) => mockRelease(...a),
  getStoredHandle: async () => ({ name: 'alice', lightningAddress: 'alice@kaleidoswap.me' }),
}));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../components/receive/ReceiveQr', () => ({ ReceiveQr: () => null }));
it('keeps notification settings out of address management and explains renaming before releasing', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<LightningAddressScreen navigation={{ goBack: jest.fn() }} />);
  await waitFor(() => expect(screen.getByText('Change username…')).toBeTruthy());
  expect(screen.queryByLabelText('Payment notifications')).toBeNull();
  fireEvent.press(screen.getByText('Change username…'));
  expect(alert).toHaveBeenCalledWith('Change Lightning address?', expect.stringContaining('anyone can claim'), expect.any(Array));
  expect(mockRelease).not.toHaveBeenCalled();
  alert.mockRestore();
});
