import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import HistoryScreen from './HistoryScreen';
const mockItems = [
  { id: 'one', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '5,000', rawSats: 5000, txid: 'hash-one', status: 'confirmed', layer: 'LN', timestamp: Date.now() - 86400000 },
  { id: 'two', type: 'receive', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '100', txid: 'hash-two', status: 'confirmed', layer: 'LN', timestamp: Date.now() - 40 * 86400000 },
];
jest.mock('../store/hooks', () => ({ useAppSelector: (f: any) => f({ wallet: { activeWallet: { id: 1 } }, swap: { swapHistory: [] }, assets: { rgbAssets: [] } }) }));
jest.mock('../hooks/usePolicy', () => ({ usePolicy: () => ({ showNetworks: false }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../hooks/useActivityFeed', () => ({ useActivityFeed: () => ({ items: mockItems, updating: false, result: null, refresh: jest.fn() }) }));
jest.mock('../services/kaleidoPay/activity', () => ({ loadPendingPaymentActivity: async () => [], loadSwapAttemptActivity: async () => [], PAYMENT_ATTEMPT_KIND: 'payment-attempt' }));
jest.mock('../services/contactHistory', () => ({ walletContactEvents: async () => [{ direction: 'sent', contactName: 'Alice', reference: 'hash-one' }] }));
jest.mock('../services/agentWallet/store', () => ({ AgentWalletStore: class { entries = async () => []; } }));
jest.mock('../components/ActivityDetailSheet', () => ({ ActivityDetailSheet: ({ item }: any) => item ? <>{require('react').createElement(require('react-native').Text, {}, `Details ${item.id}`)}</> : null }));
jest.mock('../components/Sheet', () => ({ Sheet: ({ visible, children, footer }: any) => visible ? <>{children}{footer}</> : null }));
beforeAll(() => { (require('react-native') as any).SectionList = ({ sections, renderItem, renderSectionHeader, ListEmptyComponent }: any) => sections.length ? sections.map((section: any) => <React.Fragment key={section.title}>{renderSectionHeader({ section })}{section.data.map((item: any) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)}</React.Fragment>) : ListEmptyComponent; });
test('searches the saved contact, opens its detail and resets an empty search', async () => {
  const ui = render(<HistoryScreen />);
  await act(async () => {});
  fireEvent.changeText(ui.getByLabelText('Search activity'), 'Alice');
  const row = ui.getByLabelText(/Alice.*Open details/);
  fireEvent.press(row);
  expect(ui.getByText('Details one')).toBeTruthy();
  fireEvent.changeText(ui.getByLabelText('Search activity'), 'missing');
  expect(ui.getByText('No matching activity')).toBeTruthy();
  fireEvent.press(ui.getByText('Reset filters'));
  expect(ui.getByLabelText('Search activity').props.value).toBe('');
});
test('period filter can be opened and excludes older activity', async () => {
  const ui = render(<HistoryScreen />); await act(async () => {});
  expect(ui.queryByText('7 days')).toBeNull();
  expect(ui.queryByText('Swaps')).toBeNull();
  fireEvent.press(ui.getByLabelText('Filters'));
  fireEvent.press(ui.getByText('7 days'));
  expect(ui.queryByLabelText(/100 sats.*Open details/)).toBeNull();
  expect(ui.getByLabelText(/5,000 sats.*Open details/)).toBeTruthy();
  fireEvent.press(ui.getByText('Show results'));
  expect(ui.queryByText('7 days')).toBeNull();
  fireEvent.press(ui.getByLabelText('Filters, 1 active'));
  fireEvent.press(ui.getByText('Reset filters'));
  fireEvent.press(ui.getByText('Show results'));
  expect(ui.getByLabelText(/100 sats.*Open details/)).toBeTruthy();
  expect(ui.getByLabelText('Filters')).toBeTruthy();
});
