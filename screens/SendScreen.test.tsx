import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import SendScreen from './SendScreen';
import { quotePaymentOffers, executePaymentOffer, previewInput } from '../services/kaleidoPay';

const mockPreview = { code: { kind: 'bolt11', raw: 'lnbc1', invoice: 'lnbc1' }, request: { amountSat: 1000, acceptedRails: ['ln'], networks: ['mainnet'], network: 'mainnet' }, plan: { status: 'ready' } };
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));
const mockDispatch = jest.fn();
let mockState: any;
const baseState = () => ({ settings: { bitcoinUnit: 'sats' }, wallet: { activeWallet: { id: 1 } } });
jest.mock('../store/hooks', () => ({
  useAppSelector: (f: any) => f(mockState),
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
const mockUsdb = { id: 'btkn1usdb', ticker: 'USDB', name: 'USDB', precision: 6, available: 5_000_000 };
jest.mock('../services/kaleidoPay/connect', () => ({
  usePayAccounts: () => {}, prepareRgbRequest: jest.fn(),
  prepareSparkTokenRequest: jest.fn(), sendableSparkTokens: jest.fn(async () => [mockUsdb]),
}));
jest.mock('../services/kaleidoPay/attempts', () => ({ loadPaymentAttempt: jest.fn(async () => null), beginPaymentAttempt: jest.fn(), savePaymentAttempt: jest.fn(), dismissPaymentAttempt: jest.fn(async () => {}), unresolvedAttempt: (a: any) => !a?.dismissedAt && (a?.status === 'pending' || a?.status === 'unknown') }));
jest.mock('../services/kaleidoPay', () => ({
  PaymentNotSentError: class extends Error {}, KALEIDOPAY_DEMO: false, prepareKaleidoPay: async () => {}, railLabel: (r: string) => r,
  decodeTarget: (text: string) => {
    if (text.startsWith('spark1')) return { kind: 'spark', raw: text, sparkAddress: text };
    if (!text.startsWith('ln')) throw new Error('not payable');
    return { kind: 'bolt11', raw: text, invoice: text, amountSat: 1000 };
  },
  previewInput: jest.fn(async () => mockPreview), quotePaymentOffers: jest.fn(), executePaymentOffer: jest.fn(), checkPaymentStatus: jest.fn(),
  quoteSpend: (q: any) => ({ asset: { ticker: 'sats' }, amount: q.recipientSat, fee: q.feeSat, total: q.totalSat }),
  formatSpend: (v: number) => `${v} sats`, bestOffer: (offers: any[]) => offers.filter(o => o.quote).sort((a, b) => a.quote.totalSat - b.quote.totalSat)[0],
}));
jest.mock('../services/orchestra/client', () => ({
  isOrchestraConfigured: () => true, getRoutes: jest.fn(async () => []),
  getEstimate: jest.fn(async () => ({ estimatedOut: '4990000', feeAmount: '10000', totalFeeAmount: '10000', feeBps: 20, feeAsset: 'USDB', route: ['USDB', 'USDC'] })),
}));
jest.mock('../services/crosschainSend', () => {
  class CrossChainNotSentError extends Error {}
  return {
    CrossChainNotSentError, QuoteChangedError: class extends CrossChainNotSentError {},
    loadCrossChainSession: jest.fn(async () => null), clearCrossChainSession: jest.fn(async () => {}), saveCrossChainSession: jest.fn(async () => {}),
    readSparkSource: jest.fn(async () => ({ connected: true, mainnet: true, btcSat: 0, usdb: { id: 'btkn1usdb', ticker: 'USDB', name: 'USDB', precision: 6, available: 10_000_000 } })),
    sendCrossChain: jest.fn(), submitPaid: jest.fn(), refreshOrder: jest.fn(),
  };
});
const offer = (id: string, total: number, expiresAt = Math.floor(Date.now() / 1000) + 60) => ({ id, provider: id, accountName: `Account ${id}`, executable: true, route: { kind: 'direct', sourceId: id, from: 'ln:mainnet', to: 'ln:mainnet' }, quote: { recipientSat: 1000, totalSat: total, feeSat: total - 1000, expiresAt } });
const nav = () => ({ goBack: jest.fn(), navigate: jest.fn() });
async function reviewed(navigation = nav()) {
  const screen = render(<SendScreen navigation={navigation} route={{ params: { prefilledAddress: 'lnbc1' } }} />);
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByText('Continue')); });
  return screen;
}
const pay = (screen: any, label: string) => fireEvent(screen.getByLabelText(label), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
beforeEach(() => { mockState = baseState(); (require('react-native') as any).KeyboardAvoidingView = 'KeyboardAvoidingView'; jest.clearAllMocks(); (require('../services/kaleidoPay').checkPaymentStatus as jest.Mock).mockReset(); });

test('one flow: decode, compare ways to pay, and pay only the reviewed total', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010), offer('Bark', 1020)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = await reviewed();
  expect(previewInput).toHaveBeenCalledWith('lnbc1', 1000, 'test-uuid', { asset: undefined });
  expect(executePaymentOffer).not.toHaveBeenCalled();
  expect(screen.getByText('Slide to pay 1010 sats')).toBeTruthy();
  // Pay from: one card per account, the cheapest picked.
  expect(screen.getByLabelText(/^Pay from Spark\. Total 1010 sats/).props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByLabelText('Compare ways to pay'));
  fireEvent.press(screen.getByLabelText(/^Bark\. Total you pay/));
  await act(async () => { pay(screen, 'Pay 1020 sats'); });
  expect(executePaymentOffer).toHaveBeenCalledWith(mockPreview, expect.objectContaining({ id: 'Bark' }), expect.any(String));
  expect(screen.getByText('Check status')).toBeTruthy();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'loadBtcBalance' });
});

test('anything that is not payable cannot be reviewed', async () => {
  const screen = render(<SendScreen navigation={nav()} route={{ params: { prefilledAddress: 'hello' } }} />);
  await act(async () => {});
  expect(screen.getByText('not payable')).toBeTruthy();
  expect(screen.getByText('Continue')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Continue')); });
  expect(previewInput).not.toHaveBeenCalled();
});

test('a completed payment can be closed and refreshes balances', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'completed' });
  const navigation = nav();
  const screen = await reviewed(navigation);
  await act(async () => { pay(screen, 'Pay 1010 sats'); });
  expect(screen.getByText('Payment completed')).toBeTruthy();
  expect(screen.getByText('View in Activity')).toBeTruthy();
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

test('a payment in progress is re-checked on its own until it settles', async () => {
  const { checkPaymentStatus } = require('../services/kaleidoPay');
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  (checkPaymentStatus as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = await reviewed();
  jest.useFakeTimers();
  try {
    await act(async () => { pay(screen, 'Pay 1010 sats'); });
    expect(screen.getByText('Payment in progress')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(3_000); });
    expect(checkPaymentStatus).toHaveBeenCalledWith('Spark', expect.any(String));
    const calls = (checkPaymentStatus as jest.Mock).mock.calls.length;
    (checkPaymentStatus as jest.Mock).mockResolvedValue({ status: 'completed', reference: 'h' });
    await act(async () => { jest.advanceTimersByTime(5_000); });
    expect((checkPaymentStatus as jest.Mock).mock.calls.length).toBe(calls + 1);
    expect(screen.getByText('Payment completed')).toBeTruthy();
    expect(screen.queryByText('Check status')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect((checkPaymentStatus as jest.Mock).mock.calls.length).toBe(calls + 1);
  } finally { jest.useRealTimers(); }
});

test('an unresolved payment stops being re-checked when Send closes', async () => {
  const { checkPaymentStatus } = require('../services/kaleidoPay');
  const { loadPaymentAttempt } = require('../services/kaleidoPay/attempts');
  (checkPaymentStatus as jest.Mock).mockResolvedValue({ status: 'pending' });
  loadPaymentAttempt.mockResolvedValueOnce({ id: 'p', sourceId: 'A', provider: 'A', total: '1010 sats', recipient: '1000 sats', status: 'pending', createdAt: 1 });
  jest.useFakeTimers();
  try {
    const screen = render(<SendScreen navigation={nav()} route={{ params: {} }} />);
    await act(async () => {});
    await act(async () => {});
    expect(checkPaymentStatus).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(3_000); });
    expect(checkPaymentStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Check status')).toBeTruthy();
    screen.unmount();
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(checkPaymentStatus).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});

test('rapid confirmation taps create only one payment', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = await reviewed();
  await act(async () => { pay(screen, 'Pay 1010 sats'); pay(screen, 'Pay 1010 sats'); });
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

test('picking an account card pays from it', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010), offer('Bark', 1020)]);
  (executePaymentOffer as jest.Mock).mockResolvedValue({ status: 'pending' });
  const screen = await reviewed();
  fireEvent.press(screen.getByLabelText(/^Pay from Bark\. Total 1020 sats/));
  await act(async () => { pay(screen, 'Pay 1020 sats'); });
  expect(executePaymentOffer).toHaveBeenCalledWith(mockPreview, expect.objectContaining({ id: 'Bark' }), expect.any(String));
});

test('Lite leaves Bark out unless it holds funds', async () => {
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('Spark', 1010), offer('Bark', 1005)]);
  mockState = { ...baseState(), settings: { bitcoinUnit: 'sats', disclosureLevel: 'lite' } };
  let screen = await reviewed();
  expect(screen.queryByLabelText(/^Pay from Bark/)).toBeNull();
  expect(screen.getByText('Slide to pay 1010 sats')).toBeTruthy();
  screen.unmount();
  mockState = { ...mockState, wallet: { activeWallet: { id: 1 }, btcBalance: { byProtocol: { BARK: { total: 5000 } } } } };
  screen = await reviewed();
  expect(screen.getByLabelText(/^Pay from Bark, balance 5,000 sats/)).toBeTruthy();
});

test('a Spark address can be paid in a Spark token the wallet holds', async () => {
  const { prepareSparkTokenRequest } = require('../services/kaleidoPay/connect');
  (quotePaymentOffers as jest.Mock).mockResolvedValue([offer('spark-token', 1000)]);
  const screen = render(<SendScreen navigation={nav()} route={{ params: { prefilledAddress: 'spark1recipient' } }} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText(/^Pay in USDB/));
  fireEvent.changeText(screen.getByLabelText('Amount in USDB'), '2.5');
  await act(async () => { fireEvent.press(screen.getByText('Continue')); });
  expect(prepareSparkTokenRequest).toHaveBeenLastCalledWith(mockUsdb);
  expect(previewInput).toHaveBeenCalledWith('spark1recipient', undefined, 'test-uuid',
    { asset: { id: 'btkn1usdb', ticker: 'USDB', precision: 6, amount: 2_500_000 } });
});

test('quotes show as they arrive; the first payable one is picked and kept', async () => {
  (quotePaymentOffers as jest.Mock).mockImplementation(async (_p: any, onProgress: any) => {
    onProgress([offer('Bark', 1020)]);
    return [offer('Bark', 1020), offer('Spark', 1010)];
  });
  const screen = await reviewed();
  expect(screen.getByLabelText(/^Pay from Bark/).props.accessibilityState.checked).toBe(true);
  expect(screen.getByLabelText(/^Pay from Spark/)).toBeTruthy();
});

test('an empty Send lists what it can send to, including other chains', async () => {
  const screen = render(<SendScreen navigation={nav()} route={{ params: {} }} />);
  await act(async () => {});
  expect(screen.getByText('You can send to')).toBeTruthy();
  expect(screen.getByText('Invoice · LNURL · Lightning address · BOLT12 offer')).toBeTruthy();
  expect(screen.getByText('USDC / USDT to other chains')).toBeTruthy();
  expect(screen.queryByText('Liquid')).toBeNull();
});

test('an EVM address sends USDC from Spark after review, and the transfer is tracked', async () => {
  const { sendCrossChain } = require('../services/crosschainSend');
  (sendCrossChain as jest.Mock).mockResolvedValue({
    version: 1, id: 's1', phase: 'submitted', recipient: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', family: 'evm', destChain: 'base', destToken: 'USDC',
    destDecimals: 6, source: 'USDB', mode: 'exact_in', quoteId: 'q1', depositAddress: 'spark1dep', sourceSparkAddress: 'spark1me',
    sourceAmountRaw: '5000000', expectedOutRaw: '4990000', order: { id: 'o1', status: 'processing', readToken: 'rt' }, createdAt: 1, updatedAt: 1,
  });
  const screen = render(<SendScreen navigation={nav()} route={{ params: { prefilledAddress: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed' } }} />);
  await act(async () => {});
  expect(screen.getByText('EVM address')).toBeTruthy();
  expect(screen.queryByText("This isn't something this wallet can pay.")).toBeNull();
  expect(screen.getByLabelText(/^Send bitcoin/).props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Amount to send in USDB'), '5');
  await act(async () => { await new Promise(r => setTimeout(r, 450)); });
  expect(screen.getByText('≈ 4.99 USDC')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Review')); });
  expect(sendCrossChain).not.toHaveBeenCalled();
  expect(screen.getByText(/can't be reversed/)).toBeTruthy();
  await act(async () => { pay(screen, 'Send 5 USDB'); });
  expect(sendCrossChain).toHaveBeenCalledWith(expect.objectContaining({
    walletId: 1, destDecimals: 6, reviewed: expect.objectContaining({ estimatedOut: '4990000' }),
    form: expect.objectContaining({ source: 'USDB', destChain: 'base', destToken: 'USDC', recipient: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', amountRaw: '5000000', mode: 'exact_in' }),
  }));
  expect(screen.getByText('Bridging')).toBeTruthy();
  expect(screen.getByText('Reference: o1')).toBeTruthy();
});
