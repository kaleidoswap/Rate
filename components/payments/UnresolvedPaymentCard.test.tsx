import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { UnresolvedPaymentCard } from './UnresolvedPaymentCard';
import { loadPaymentAttempt } from '../../services/kaleidoPay/attempts';
let mockWalletId = 1;
jest.mock('../../store/hooks', () => ({ useAppSelector: (f: any) => f({ wallet: { activeWallet: { id: mockWalletId } } }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]) }));
jest.mock('../../services/kaleidoPay/attempts', () => ({ loadPaymentAttempt: jest.fn(), unresolvedAttempt: (attempt: any) => ['pending', 'unknown'].includes(attempt?.status) }));
beforeEach(() => { jest.clearAllMocks(); mockWalletId = 1; });
test('offers recovery for unknown outcomes without executing or retrying a payment', async () => {
  (loadPaymentAttempt as jest.Mock).mockResolvedValue({ status: 'unknown', total: '120 sats', provider: 'Provider' });
  const onCheck = jest.fn();
  const screen = render(<UnresolvedPaymentCard onCheck={onCheck} />);
  await act(async () => {});
  expect(screen.getByText('Payment needs checking')).toBeTruthy();
  fireEvent.press(screen.getByText('Check payment'));
  expect(onCheck).toHaveBeenCalledTimes(1);
});
test('a late read cannot show the previous wallet payment after switching wallets', async () => {
  let complete!: (v: unknown) => void;
  (loadPaymentAttempt as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce(null);
  const screen = render(<UnresolvedPaymentCard onCheck={jest.fn()} />);
  mockWalletId = 2;
  screen.rerender(<UnresolvedPaymentCard onCheck={jest.fn()} />);
  await act(async () => { complete({ status: 'unknown', total: '120 sats', provider: 'Old wallet' }); });
  expect(screen.queryByText('Payment needs checking')).toBeNull();
});
