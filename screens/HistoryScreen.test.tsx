import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import HistoryScreen from './HistoryScreen';
const mockItems = [
  { id: 'one', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '5,000', rawSats: 5000, txid: 'hash-one', status: 'confirmed', layer: 'LN', timestamp: Date.now() - 86400000 },
  { id: 'two', type: 'receive', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '100', txid: 'hash-two', status: 'confirmed', layer: 'LN', timestamp: Date.now() - 40 * 86400000 },
];
jest.mock('../store/hooks', () => ({ useAppSelector: (f: any) => f({ wallet: { activeWallet: { id: 1 } }, swap: { swapHistory: [] }, assets: { rgbAssets: [] } }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../hooks/useActivityFeed', () => ({ useActivityFeed: () => ({ items: mockItems, updating: false, result: null, refresh: jest.fn() }) }));
let mockPending: any[] = [];
const mockDismissPending = jest.fn(async () => true);
jest.mock('../services/kaleidoPay/activity', () => ({
  loadPendingPaymentActivity: async () => mockPending, loadSwapAttemptActivity: async () => [], PAYMENT_ATTEMPT_KIND: 'payment-attempt',
  paymentAttemptIdOf: (item: any) => item.kind === 'payment-attempt' ? item.id.replace('payment-attempt-', '') : undefined,
  dismissPendingPayment: (...args: any[]) => (mockDismissPending as any)(...args),
}));
const mockCancelPending = jest.fn();
jest.mock('../services/kaleidoPay/cancelPayment', () => ({ cancelPendingPayment: (...args: any[]) => mockCancelPending(...args) }));
jest.mock('../services/contactHistory', () => ({ walletContactEvents: async () => [{ direction: 'sent', contactName: 'Alice', reference: 'hash-one' }] }));
jest.mock('../services/agentWallet/store', () => ({ AgentWalletStore: class { entries = async () => []; } }));
jest.mock('../components/ActivityDetailSheet', () => ({ ActivityDetailSheet: ({ item }: any) => item ? <>{require('react').createElement(require('react-native').Text, {}, `Details ${item.id}`)}</> : null }));
jest.mock('../components/Sheet', () => ({ Sheet: ({ visible, children, footer }: any) => visible ? <>{children}{footer}</> : null }));
beforeAll(() => { (require('react-native') as any).SectionList = ({ sections, renderItem, renderSectionHeader, ListEmptyComponent }: any) => sections.length ? sections.map((section: any) => <React.Fragment key={section.title}>{renderSectionHeader({ section })}{section.data.map((item: any) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)}</React.Fragment>) : ListEmptyComponent; });
test('has no search field; rows show the saved contact and open their detail', async () => {
  const ui = render(<HistoryScreen />);
  await act(async () => {});
  expect(ui.queryByLabelText('Search activity')).toBeNull();
  fireEvent.press(ui.getByLabelText(/Alice.*Open details/));
  expect(ui.getByText('Details one')).toBeTruthy();
});
test('filter sheet: period chips filter the list, show active chips and reset', async () => {
  const ui = render(<HistoryScreen />); await act(async () => {});
  expect(ui.queryByText('7 days')).toBeNull();
  expect(ui.queryByText('Swaps')).toBeNull();
  fireEvent.press(ui.getByLabelText('Filters'));
  fireEvent.press(ui.getByText('7 days'));
  expect(ui.queryByLabelText(/100 sats.*Open details/)).toBeNull();
  expect(ui.getByLabelText(/5,000 sats.*Open details/)).toBeTruthy();
  fireEvent.press(ui.getByText('Show 1 result'));
  expect(ui.queryByText('7 days')).toBeNull();
  // The active filter shows as a removable chip under the header.
  expect(ui.getByLabelText('Remove filter Last 7 days')).toBeTruthy();
  fireEvent.press(ui.getByLabelText('Filters, 1 active'));
  fireEvent.press(ui.getByText('Reset'));
  fireEvent.press(ui.getByText('Show 2 results'));
  expect(ui.getByLabelText(/100 sats.*Open details/)).toBeTruthy();
  expect(ui.getByLabelText('Filters')).toBeTruthy();
  expect(ui.queryByLabelText(/Remove filter/)).toBeNull();
});
test('removing an active chip clears that filter', async () => {
  const ui = render(<HistoryScreen />); await act(async () => {});
  fireEvent.press(ui.getByLabelText('Filters'));
  fireEvent.press(ui.getByText('Sent'));
  fireEvent.press(ui.getByText('Show 1 result'));
  expect(ui.queryByLabelText(/100 sats.*Open details/)).toBeNull();
  fireEvent.press(ui.getByLabelText('Remove filter Sent'));
  expect(ui.getByLabelText(/100 sats.*Open details/)).toBeTruthy();
  expect(ui.getByLabelText('Filters')).toBeTruthy();
});

test('Cancel payment from a long press checks with the provider and offers removal when it is in flight', async () => {
  mockPending = [{ id: 'payment-attempt-p2', kind: 'payment-attempt', type: 'send', source: 'payment', asset: 'BTC', assetName: 'bob', assetTicker: '', assetPrecision: 0, amount: '3,000 sats', txid: '', status: 'pending', layer: 'LN', timestamp: Date.now() }];
  mockCancelPending.mockResolvedValueOnce({ outcome: 'in-flight', message: 'can’t be called back' });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  const ui = render(<HistoryScreen />); await act(async () => {});
  fireEvent(ui.getByLabelText(/3,000 sats.*Open details/), 'longPress');
  await act(async () => { (alert.mock.calls[0][2] as any[]).find(b => b.text === 'Cancel payment').onPress(); });
  expect(alert.mock.calls[1][0]).toBe('Cancel this payment?');
  expect(mockCancelPending).not.toHaveBeenCalled();
  await act(async () => { await (alert.mock.calls[1][2] as any[]).find(b => b.style === 'destructive').onPress(); });
  expect(mockCancelPending).toHaveBeenCalledWith(1, 'p2');
  expect(alert.mock.calls[2][0]).toBe('Can’t cancel this payment');
  expect((alert.mock.calls[2][2] as any[]).map(b => b.text)).toContain('Remove from Activity');
  // Still listed: nothing was cancelled.
  expect(ui.getByLabelText(/3,000 sats.*Open details/)).toBeTruthy();
  alert.mockRestore();
  mockPending = [];
});

test('a payment needing a check is removed from Activity by a long press, only after confirming', async () => {
  mockPending = [{ id: 'payment-attempt-p1', kind: 'payment-attempt', type: 'send', source: 'payment', asset: 'BTC', assetName: 'bob', assetTicker: '', assetPrecision: 0, amount: '2,000 sats', txid: '', status: 'unknown', layer: 'RGB-LN', timestamp: Date.now() }];
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  const ui = render(<HistoryScreen />); await act(async () => {});
  expect(ui.getAllByText('Needs checking').length).toBeGreaterThan(0);
  fireEvent(ui.getByLabelText(/2,000 sats.*Open details/), 'longPress');
  // The long press offers Cancel payment or Remove from Activity.
  const choices = alert.mock.calls[0][2] as any[];
  expect(choices.map(b => b.text)).toEqual(['Keep', 'Cancel payment', 'Remove from Activity']);
  await act(async () => { choices.find(b => b.text === 'Remove from Activity').onPress(); });
  expect(mockDismissPending).not.toHaveBeenCalled();
  expect(alert.mock.calls[1][1]).toMatch(/does not cancel the payment or move any funds/);
  const buttons = alert.mock.calls[1][2] as any[];
  await act(async () => { await buttons.find(b => b.style === 'destructive').onPress(); });
  expect(mockDismissPending).toHaveBeenCalledWith(1, 'p1');
  expect(ui.queryByLabelText(/2,000 sats.*Open details/)).toBeNull();
  // Settled history rows have no remove action.
  alert.mockClear();
  fireEvent(ui.getByLabelText(/5,000 sats.*Open details/), 'longPress');
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
  mockPending = [];
});
