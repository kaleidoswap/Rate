import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import PaymentConfirmationModal from './PaymentConfirmationModal';
import { swapReadback } from '../services/aiConfirm';
import { authorizeSpend } from '../services/spendAuth';

jest.mock('../services/spendAuth', () => ({ authorizeSpend: jest.fn() }));
jest.mock('../services/SecurityService', () => ({
  __esModule: true,
  default: { getInstance: () => ({ verifyPin: jest.fn(async (p: string) => p === '1234') }) },
}));
jest.mock('../services/swapTools', () => ({ describeSwapQuote: jest.fn() }));
jest.mock('../services/walletTools', () => ({ previewSendPayment: jest.fn(), lightningRailLabel: jest.fn() }));

const readback = swapReadback({
  quoteId: 'q1', venue: 'flashnet', from: 'BTC', to: 'USDB', sendAmount: 25_000, receiveAmount: 20.1,
  receiveUnit: 'USDB', fee: 50, feeUnit: 'sats', fromLayer: 'Spark', toLayer: 'Spark', expiresAt: Date.now() + 25_000,
});

const holdToConfirm = (view: ReturnType<typeof render>) =>
  fireEvent(view.getByTestId('hold-to-confirm'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });

describe('PaymentConfirmationModal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the swap readback with the expiry countdown', () => {
    const view = render(<PaymentConfirmationModal inline visible readback={readback} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(view.getByText('25,000 sats')).toBeTruthy();
    expect(view.getByText('20.1 USDB · Spark')).toBeTruthy();
    expect(view.getByText('50 sats')).toBeTruthy();
    expect(view.getByText('Flashnet')).toBeTruthy();
    expect(view.getByText(/Quote expires in \d+ s/)).toBeTruthy();
  });

  it('confirms without a second factor below the threshold', () => {
    const onConfirm = jest.fn();
    const view = render(<PaymentConfirmationModal inline visible readback={readback} onConfirm={onConfirm} onCancel={jest.fn()} />);
    holdToConfirm(view);
    expect(onConfirm).toHaveBeenCalled();
    expect(authorizeSpend).not.toHaveBeenCalled();
  });

  it('requires biometrics above the threshold and falls back to the PIN', async () => {
    (authorizeSpend as jest.Mock).mockResolvedValueOnce('pin');
    const onConfirm = jest.fn();
    const view = render(<PaymentConfirmationModal inline visible readback={readback} requireAuth onConfirm={onConfirm} onCancel={jest.fn()} />);
    await act(async () => { holdToConfirm(view); });
    expect(authorizeSpend).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.changeText(view.getByLabelText('Wallet PIN'), '1234');
    await act(async () => { fireEvent.press(view.getByText('OK')); });
    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not confirm when authentication is refused', async () => {
    (authorizeSpend as jest.Mock).mockResolvedValueOnce('denied');
    const onConfirm = jest.fn();
    const view = render(<PaymentConfirmationModal inline visible readback={readback} requireAuth onConfirm={onConfirm} onCancel={jest.fn()} />);
    await act(async () => { holdToConfirm(view); });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(view.getByText('Not approved. Hold again to retry.')).toBeTruthy();
  });

  it('shows Processing while the approved action runs', () => {
    const view = render(<PaymentConfirmationModal inline visible readback={readback} loading onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(view.getByText('Processing…')).toBeTruthy();
    expect(view.queryByTestId('hold-to-confirm')).toBeNull();
  });
});

it('keeps payment amount, recipient and fee visible without duplicating the fee', () => {
  const view = render(<PaymentConfirmationModal inline visible readback={{
    kind: 'payment', title: 'Confirm payment', cta: 'Send', amount: '1,000 sats', recipientName: 'Alice', spoken: '',
    rows: [{ label: 'Contact', value: 'Alice' }, { label: 'Fee', value: 'Up to 3 sats' }, { label: 'Network', value: 'Spark' }],
  }} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(view.getByText('1,000 sats')).toBeTruthy();
  expect(view.getAllByText('Alice')).toHaveLength(1);
  expect(view.getAllByText('Up to 3 sats')).toHaveLength(1);
  expect(view.getByText('Spark')).toBeTruthy();
});
it('does not imply a free payment when legacy callers have no fee', () => {
  const view = render(<PaymentConfirmationModal inline visible paymentDetails={{
    type: 'lightning_address', recipient: 'alice@example.com', amount: 1000,
  }} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(view.getByText('Fee')).toBeTruthy();
  expect(view.getByText('Not available yet')).toBeTruthy();
  expect(view.queryByText('0 sats')).toBeNull();
});
