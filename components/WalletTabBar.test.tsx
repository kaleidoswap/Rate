import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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
