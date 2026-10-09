import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { IntentSheet } from './IntentSheet';
import type { IntentOutcome } from '../../services/mindIntents/run';

let mockOutcome: IntentOutcome | null = null;
const mockSubmit = jest.fn();
const mockReset = jest.fn();
jest.mock('../../hooks/useIntentRunner', () => ({
  useIntentRunner: () => ({ submit: mockSubmit, busy: false, outcome: mockOutcome, reset: mockReset, advanced: false }),
}));
jest.mock('../../hooks/useFiatRates', () => ({ useFiatRates: () => ({ eur: 50_000 }), FIAT_SYMBOLS: { EUR: '€' } }));
jest.mock('../../store/hooks', () => ({
  useAppSelector: (f: any) => f({ settings: { bitcoinUnit: 'sats', currency: 'EUR', aiMode: 'off' } }),
}));
jest.mock('../Sheet', () => ({
  Sheet: ({ visible, children }: any) => (visible ? children : null),
}));

const sendCard: IntentOutcome = {
  type: 'action',
  result: { intent: { kind: 'send' }, source: 'rules', confident: true },
  card: {
    kind: 'send', title: 'Send to Mario Rossi', asset: 'BTC', amountSat: 20_000,
    fiat: { value: 10, currency: 'EUR', typed: true },
    recipient: { name: 'Mario Rossi', destination: 'mario@ln.example' },
    route: 'Spark · Lightning', fee: { status: 'quoted', sat: 12 }, warnings: [],
    review: { screen: 'Send', params: { prefilledAddress: 'mario@ln.example', contactName: 'Mario Rossi', prefilledAmountSat: 20_000 } },
  },
};

beforeEach(() => { mockOutcome = null; jest.clearAllMocks(); });

test('typing and submitting runs the intent', async () => {
  const screen = render(<IntentSheet visible onClose={jest.fn()} onReview={jest.fn()} />);
  fireEvent.changeText(screen.getByTestId('intent-input'), 'send 10€ to Mario');
  await act(async () => { fireEvent.press(screen.getByTestId('intent-go')); });
  expect(mockSubmit).toHaveBeenCalledWith('send 10€ to Mario');
});

test('an example chip runs straight away', async () => {
  const screen = render(<IntentSheet visible onClose={jest.fn()} onReview={jest.fn()} />);
  await act(async () => { fireEvent.press(screen.getByText('Swap half my BTC to USDT')); });
  expect(mockSubmit).toHaveBeenCalledWith('Swap half my BTC to USDT');
});

test('the action card shows wallet numbers and Review hands the params to the existing screen', () => {
  mockOutcome = sendCard;
  const onReview = jest.fn();
  const onClose = jest.fn();
  const screen = render(<IntentSheet visible onClose={onClose} onReview={onReview} />);
  expect(screen.getByText('Send to Mario Rossi')).toBeTruthy();
  expect(screen.getByText('20,000 sats')).toBeTruthy();
  expect(screen.getByText('€10.00')).toBeTruthy();
  expect(screen.getByText('≈ 12 sats')).toBeTruthy();
  // Lite hides which account pays.
  expect(screen.queryByText('Spark · Lightning')).toBeNull();
  fireEvent.press(screen.getByText('Review'));
  expect(onReview).toHaveBeenCalledWith({ screen: 'Send', params: { prefilledAddress: 'mario@ln.example', contactName: 'Mario Rossi', prefilledAmountSat: 20_000 } });
  expect(onClose).toHaveBeenCalled();
});

test('Edit clears the card, Cancel closes', () => {
  mockOutcome = sendCard;
  const onClose = jest.fn();
  const screen = render(<IntentSheet visible onClose={onClose} onReview={jest.fn()} />);
  fireEvent.press(screen.getByText('Edit'));
  expect(mockReset).toHaveBeenCalled();
  fireEvent.press(screen.getByText('Cancel'));
  expect(onClose).toHaveBeenCalled();
});

test('warnings and answers render', () => {
  mockOutcome = { ...sendCard, card: { ...(sendCard as any).card, warnings: ['No contact named “Zed”.'] } } as IntentOutcome;
  const screen = render(<IntentSheet visible onClose={jest.fn()} onReview={jest.fn()} />);
  expect(screen.getByText('No contact named “Zed”.')).toBeTruthy();
  mockOutcome = { type: 'answer', result: { intent: { kind: 'spending' }, source: 'rules', confident: true },
    answer: { kind: 'spending', title: 'Spent in the last 7 days', totalSat: 12_000, rows: [{ label: 'Fees', sat: 6 }], note: '3 payments' } };
  screen.rerender(<IntentSheet visible onClose={jest.fn()} onReview={jest.fn()} />);
  expect(screen.getByText('Spent in the last 7 days')).toBeTruthy();
  expect(screen.getByText('12,000 sats')).toBeTruthy();
  expect(screen.getByText('3 payments')).toBeTruthy();
});
