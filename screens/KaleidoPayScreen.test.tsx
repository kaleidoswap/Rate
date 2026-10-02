import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import KaleidoPayScreen from './KaleidoPayScreen';
import { quotePaymentOffers, executePaymentOffer } from '../services/kaleidoPay';
const mockPreview = { code: {}, request: { amountSat: 1000, acceptedRails: ['ln'] }, plan: { status: 'ready' } };
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));
jest.mock('../store/hooks', () => ({ useAppSelector: (f: any) => f({ settings: { bitcoinUnit: 'sats' }, wallet: { activeWallet: { id: 1 } } }) }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapter: () => undefined } }));
jest.mock('../services/protocols/MobileSparkAdapter', () => ({ MobileSparkAdapter: class {} }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader' }));
jest.mock('../components/Button', () => ({ Button: ({ title, onPress, disabled }: any) => {
  const { Text, TouchableOpacity } = require('react-native'); return <TouchableOpacity disabled={disabled} onPress={onPress}><Text>{title}</Text></TouchableOpacity>;
} }));
jest.mock('../services/kaleidoPay/attempts', () => ({ loadPaymentAttempt: jest.fn(async () => null), beginPaymentAttempt: jest.fn(), savePaymentAttempt: jest.fn(), unresolvedAttempt: (a: any) => a?.status === 'pending' || a?.status === 'unknown' }));
jest.mock('../services/kaleidoPay', () => ({
  PaymentNotSentError: class extends Error {}, codeNetwork: () => undefined, prepareKaleidoPay: async () => {}, railLabel: (r: string) => r,
  previewPayment: () => mockPreview, quotePaymentOffers: jest.fn(), executePaymentOffer: jest.fn(), checkPaymentStatus: jest.fn(), registerKaleidoPayAccount: jest.fn(),
  quoteSpend: (q: any) => ({ asset: { ticker: 'sats' }, amount: q.recipientSat, fee: q.feeSat, total: q.totalSat }),
  formatSpend: (v: number) => `${v} sats`, bestOffer: (offers: any[]) => offers.filter(o => o.quote).sort((a, b) => a.quote.totalSat - b.quote.totalSat)[0],
}));
const offer = (id: string, total: number, expiresAt = Math.floor(Date.now() / 1000) + 60) => ({ id, provider: id, accountName: `Account ${id}`, executable: true, route: { kind: 'swap', sourceId: id }, quote: { recipientSat: 1000, totalSat: total, feeSat: total - 1000, expiresAt } });
beforeEach(() => { (require('react-native') as any).KeyboardAvoidingView = 'KeyboardAvoidingView'; jest.clearAllMocks(); });
test('allows explicit provider selection and pays only after the reviewed total is pressed', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('A', 1010), offer('B', 1020)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = render(<KaleidoPayScreen navigation={{ goBack: jest.fn() }} route={{ params: { code: 'request' } }} />);
  await act(async () => {});
  expect(executePaymentOffer).not.toHaveBeenCalled(); expect(screen.getByText('Pay 1010 sats')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Payment details'));
  fireEvent.press(screen.getAllByText('Compare ways to pay')[0]);
  fireEvent.press(screen.getByLabelText(/^B\. Total you pay/));
  expect(screen.getByText('Pay 1020 sats')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Pay 1020 sats')); });
  expect(executePaymentOffer).toHaveBeenCalledWith(mockPreview, expect.objectContaining({ id: 'B' }), expect.any(String));
  expect(screen.getByText('Check status')).toBeTruthy(); expect(screen.queryByText('Pay 1020 sats')).toBeNull();
});
test('refresh retains selected provider and requires reviewing a changed total', async () => {
  jest.useFakeTimers();
  (quotePaymentOffers as jest.Mock).mockResolvedValueOnce([offer('A', 1010, Math.floor(Date.now() / 1000) + 1), offer('B', 1020)])
    .mockResolvedValueOnce([offer('A', 1050), offer('B', 1005)]);
  const screen = render(<KaleidoPayScreen navigation={{ goBack: jest.fn() }} route={{ params: { code: 'request' } }} />);
  await act(async () => {});
  act(() => { jest.advanceTimersByTime(2000); });
  await act(async () => { fireEvent.press(screen.getByText('Refresh quotes')); });
  expect(screen.getByText('Review updated quote')).toBeTruthy(); expect(screen.queryByText('Pay 1005 sats')).toBeNull();
  fireEvent.press(screen.getByText('Review updated quote')); expect(screen.getByText('Pay 1050 sats')).toBeTruthy();
  expect(executePaymentOffer).not.toHaveBeenCalled(); screen.unmount(); jest.useRealTimers();
});
test('a completed payment stays completed if saving the final receipt fails', async () => {
  const { savePaymentAttempt } = require('../services/kaleidoPay/attempts');
  savePaymentAttempt.mockRejectedValueOnce(new Error('disk unavailable'));
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('A', 1010)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'completed' });
  const screen = render(<KaleidoPayScreen navigation={{ goBack: jest.fn() }} route={{ params: { code: 'request' } }} />);
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByText('Pay 1010 sats')); });
  expect(screen.getByText('Payment completed')).toBeTruthy();
  expect(screen.queryByText('Check status')).toBeNull();
  expect(executePaymentOffer).toHaveBeenCalledTimes(1);
});
test('restores an unresolved payment instead of opening a fresh payment review', async () => {
  const { loadPaymentAttempt } = require('../services/kaleidoPay/attempts');
  loadPaymentAttempt.mockResolvedValueOnce({ id: 'pending', sourceId: 'A', provider: 'A', total: '1010 sats', recipient: '1000 sats', status: 'pending' });
  const screen = render(<KaleidoPayScreen navigation={{ goBack: jest.fn() }} route={{ params: { code: 'request' } }} />);
  await act(async () => {});
  expect(screen.getByText('Check status')).toBeTruthy();
  expect(quotePaymentOffers).not.toHaveBeenCalled();
  expect(executePaymentOffer).not.toHaveBeenCalled();
});
test('rapid confirmation taps create only one payment', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('A', 1010)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = render(<KaleidoPayScreen navigation={{ goBack: jest.fn() }} route={{ params: { code: 'request' } }} />);
  await act(async () => {});
  const button = screen.getByText('Pay 1010 sats');
  await act(async () => { fireEvent.press(button); fireEvent.press(button); });
  expect(executePaymentOffer).toHaveBeenCalledTimes(1);
});
