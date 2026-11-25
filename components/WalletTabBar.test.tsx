import type { ActivityItem } from '../services/ActivityService';

let mockLanguage = 'en';
let mockPending: Pick<ActivityItem, 'type' | 'layer' | 'status'>[] = [];
jest.mock('../store/hooks', () => ({ useAppSelector: (selector: any) => selector({ settings: { language: mockLanguage }, wallet: mockPending.length > 0 ? { activeWallet: { id: 1 } } : {} }) }));
jest.mock('../services/kaleidoPay/activity', () => ({ loadPendingPaymentActivity: async () => mockPending }));
beforeEach(() => { mockLanguage = 'en'; mockPending = []; });
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { WalletTabBar } from './WalletTabBar';

function props(tabNames = ['DashboardTab', 'Activity', 'Contacts', 'Mind']) {
  const routes = tabNames.map(name => ({ key: name, name }));
  return {
    state: { index: 0, routes },
    descriptors: Object.fromEntries(routes.map(route => [route.key, { options: { tabBarLabel: route.name === 'DashboardTab' ? 'Wallet' : route.name } }])),
    navigation: { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) },
  } as any;
}

describe('wallet navigation', () => {
  it('opens the payment scanner with one press', () => {
    const p = props();
    const screen = render(<WalletTabBar {...p} />);
    fireEvent.press(screen.getByLabelText('Scan a payment QR code'));
    expect(p.navigation.navigate).toHaveBeenCalledWith('QRScanner');
  });
  it('keeps Scan between Wallet and Activity when Labs tabs are off', () => {
    const screen = render(<WalletTabBar {...props(['DashboardTab', 'Activity'])} />);
    expect(screen.getAllByText(/^(Wallet|Scan|Activity)$/).map(node => node.props.children)).toEqual([
      'Wallet', 'Scan', 'Activity',
    ]);
  });
  it('makes activity a direct destination and preserves tab event cancellation', () => {
    const p = props();
    const screen = render(<WalletTabBar {...p} />);
    fireEvent.press(screen.getByLabelText('Activity'));
    expect(p.navigation.navigate).toHaveBeenCalledWith('Activity');
    p.navigation.navigate.mockClear();
    p.navigation.emit.mockReturnValue({ defaultPrevented: true });
    fireEvent.press(screen.getByLabelText('Mind'));
    expect(p.navigation.navigate).not.toHaveBeenCalled();
  });
});

it('updates tab labels from the shared app language', () => {
  mockLanguage = 'it';
  const screen = render(<WalletTabBar {...props()} />);
  expect(screen.getByText('Portafoglio')).toBeTruthy();
  expect(screen.getByText('Attività')).toBeTruthy();
  expect(screen.getByText('Scansiona')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Scansiona un codice QR di pagamento' })).toBeTruthy();
});

it('exposes the selected destination when the navigation state changes', () => {
  const p = props();
  const screen = render(<WalletTabBar {...p} />);
  expect(screen.getByRole('tab', { selected: true, name: 'Wallet' })).toBeTruthy();
  screen.rerender(<WalletTabBar {...p} state={{ ...p.state, index: 1 }} />);
  expect(screen.getByRole('tab', { selected: true, name: 'Activity' })).toBeTruthy();
});

it('the Activity tab wears the count of payments that need attention', async () => {
  mockPending = [
    { type: 'send', layer: 'RGB-LN', status: 'pending' },
    { type: 'send', layer: 'RGB-LN', status: 'unknown' },
    { type: 'send', layer: 'Spark', status: 'pending' },
  ];
  const screen = render(<WalletTabBar {...props()} />);
  await act(async () => {});
  expect(screen.getByText('2')).toBeTruthy();
  expect(screen.getByLabelText('Activity, 2 payments need attention')).toBeTruthy();
  // No badge without pending payments, and never on other tabs.
  mockPending = [];
  screen.rerender(<WalletTabBar {...props()} />);
  await act(async () => {});
  expect(screen.queryByLabelText(/needs attention/)).toBeNull();
});
