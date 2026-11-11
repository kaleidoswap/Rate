let mockLanguage = 'en';
let mockPending = 0;
jest.mock('../store/hooks', () => ({ useAppSelector: (selector: any) => selector({ settings: { language: mockLanguage }, wallet: mockPending ? { activeWallet: { id: 1 } } : {} }) }));
jest.mock('../services/kaleidoPay/activity', () => ({ loadPendingPaymentActivity: async () => Array.from({ length: mockPending }) }));
beforeEach(() => { mockLanguage = 'en'; mockPending = 0; });
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { WalletTabBar } from './WalletTabBar';

function props() {
  const routes = ['DashboardTab', 'Activity', 'Contacts', 'Mind'].map(name => ({ key: name, name }));
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
});

it('the Activity tab wears the count of payments that need attention', async () => {
  mockPending = 2;
  const screen = render(<WalletTabBar {...props()} />);
  await act(async () => {});
  expect(screen.getByText('2')).toBeTruthy();
  expect(screen.getByLabelText('Activity, 2 payments need attention')).toBeTruthy();
  // No badge without pending payments, and never on other tabs.
  mockPending = 0;
  screen.rerender(<WalletTabBar {...props()} />);
  await act(async () => {});
  expect(screen.queryByLabelText(/needs attention/)).toBeNull();
});
