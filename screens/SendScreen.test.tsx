import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import SendScreen from './SendScreen';
import { quotePaymentOffers, executePaymentOffer, previewInput } from '../services/kaleidoPay';

const mockPreview = { code: { kind: 'bolt11', raw: 'lnbc1', invoice: 'lnbc1' }, request: { amountSat: 1000, acceptedRails: ['ln'], networks: ['mainnet'], network: 'mainnet' }, plan: { status: 'ready' } };
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));
const mockDispatch = jest.fn();
jest.mock('../store/hooks', () => ({
  useAppSelector: (f: any) => f({ settings: { bitcoinUnit: 'sats' }, wallet: { activeWallet: { id: 1 } } }),
  useAppDispatch: () => mockDispatch,
}));
jest.mock('../store/slices/walletSlice', () => ({ loadBtcBalance: () => ({ type: 'loadBtcBalance' }) }));
jest.mock('../hooks/useFiatRates', () => ({ useFiatRates: () => ({ usd: 100000 }) }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader' }));
jest.mock('../components/AmountEditorModal', () => ({ AmountEditorModal: () => null }));
jest.mock('../components/NostrContactsSelector', () => () => null);
jest.mock('../components/Button', () => ({ Button: ({ title, onPress, disabled }: any) => {
  const { Text, TouchableOpacity } = require('react-native'); return <TouchableOpacity disabled={disabled} onPress={onPress}><Text>{title}</Text></TouchableOpacity>;
} }));
jest.mock('../services/kaleidoPay/connect', () => ({ usePayAccounts: () => {}, prepareRgbRequest: jest.fn() }));
jest.mock('../services/kaleidoPay/attempts', () => ({ loadPaymentAttempt: jest.fn(async () => null), beginPaymentAttempt: jest.fn(), savePaymentAttempt: jest.fn(), dismissPaymentAttempt: jest.fn(async () => {}), unresolvedAttempt: (a: any) => !a?.dismissedAt && (a?.status === 'pending' || a?.status === 'unknown') }));
jest.mock('../services/kaleidoPay', () => ({
  PaymentNotSentError: class extends Error {}, KALEIDOPAY_DEMO: false, prepareKaleidoPay: async () => {}, railLabel: (r: string) => r,
  decodeTarget: (text: string) => { if (!text.startsWith('ln')) throw new Error('not payable'); return { kind: 'bolt11', raw: text, invoice: text, amountSat: 1000 }; },
  previewInput: jest.fn(async () => mockPreview), quotePaymentOffers: jest.fn(), executePaymentOffer: jest.fn(), checkPaymentStatus: jest.fn(),
  quoteSpend: (q: any) => ({ asset: { ticker: 'sats' }, amount: q.recipientSat, fee: q.feeSat, total: q.totalSat }),
  formatSpend: (v: number) => `${v} sats`, bestOffer: (offers: any[]) => offers.filter(o => o.quote).sort((a, b) => a.quote.totalSat - b.quote.totalSat)[0],
}));
const offer = (id: string, total: number, expiresAt = Math.floor(Date.now() / 1000) + 60) => ({ id, provider: id, accountName: `Account ${id}`, executable: true, route: { kind: 'direct', sourceId: id, from: 'ln:mainnet', to: 'ln:mainnet' }, quote: { recipientSat: 1000, totalSat: total, feeSat: total - 1000, expiresAt } });
const nav = () => ({ goBack: jest.fn(), navigate: jest.fn() });
async function reviewed(navigation = nav()) {
  const screen = render(<SendScreen navigation={navigation} route={{ params: { prefilledAddress: 'lnbc1' } }} />);
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByText('Review payment')); });
  return screen;
}
beforeEach(() => { (require('react-native') as any).KeyboardAvoidingView = 'KeyboardAvoidingView'; jest.clearAllMocks(); });

test('one flow: decode, compare ways to pay, and pay only the reviewed total', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010), offer('Bark', 1020)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = await reviewed();
  expect(previewInput).toHaveBeenCalledWith('lnbc1', 1000, 'test-uuid', { asset: undefined });
  expect(executePaymentOffer).not.toHaveBeenCalled();
  expect(screen.getByText('Pay 1010 sats')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Payment details'));
  fireEvent.press(screen.getAllByText('Compare ways to pay')[0]);
  fireEvent.press(screen.getByLabelText(/^Bark\. Total you pay/));
  await act(async () => { fireEvent.press(screen.getByText('Pay 1020 sats')); });
  expect(executePaymentOffer).toHaveBeenCalledWith(mockPreview, expect.objectContaining({ id: 'Bark' }), expect.any(String));
  expect(screen.getByText('Check status')).toBeTruthy();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'loadBtcBalance' });
});

test('anything that is not payable cannot be reviewed', async () => {
  const screen = render(<SendScreen navigation={nav()} route={{ params: { prefilledAddress: 'hello' } }} />);
  await act(async () => {});
  expect(screen.getByText('not payable')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Review payment')); });
  expect(previewInput).not.toHaveBeenCalled();
});

test('a completed payment can be closed and refreshes balances', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'completed' });
  const navigation = nav();
  const screen = await reviewed(navigation);
  await act(async () => { fireEvent.press(screen.getByText('Pay 1010 sats')); });
  expect(screen.getByText('Payment completed')).toBeTruthy();
  fireEvent.press(screen.getByText('Done'));
  expect(navigation.goBack).toHaveBeenCalled();
});

test('an unresolved payment is shown instead of a new review', async () => {
  const { loadPaymentAttempt } = require('../services/kaleidoPay/attempts');
  loadPaymentAttempt.mockResolvedValueOnce({ id: 'pending', sourceId: 'A', provider: 'A', total: '1010 sats', recipient: '1000 sats', status: 'pending' });
  const screen = render(<SendScreen navigation={nav()} route={{ params: {} }} />);
  await act(async () => {});
  expect(screen.getByText('Check status')).toBeTruthy();
  expect(quotePaymentOffers).not.toHaveBeenCalled();
});

test('rapid confirmation taps create only one payment', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = await reviewed();
  const button = screen.getByText('Pay 1010 sats');
  await act(async () => { fireEvent.press(button); fireEvent.press(button); });
  expect(executePaymentOffer).toHaveBeenCalledTimes(1);
});

test('a payment that needs checking can be moved past only after confirming the warning', async () => {
  const { loadPaymentAttempt, dismissPaymentAttempt } = require('../services/kaleidoPay/attempts');
  const unknown = { id: 'u', sourceId: 'A', provider: 'A', total: '1010 sats', recipient: '1000 sats', status: 'unknown', createdAt: 1 };
  loadPaymentAttempt.mockResolvedValueOnce(unknown);
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  const screen = render(<SendScreen navigation={nav()} route={{ params: {} }} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Start a new payment'));
  expect(dismissPaymentAttempt).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] as any[];
  await act(async () => { await buttons.find(b => b.style === 'destructive').onPress(); });
  expect(dismissPaymentAttempt).toHaveBeenCalledWith(1, unknown);
  expect(screen.queryByText('Check status')).toBeNull();
  alert.mockRestore();
});
