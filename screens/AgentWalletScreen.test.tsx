import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AgentWalletScreen from './AgentWalletScreen';
import { DEFAULT_POLICY } from '../services/agentWallet/policy';

const mockHook: any = {};
let mockAdvanced = true;
jest.mock('../hooks/useAgentWallet', () => ({ useAgentWallet: () => mockHook }));
jest.mock('../hooks/usePolicy', () => ({ usePolicy: () => ({ showNetworks: mockAdvanced }) }));
jest.mock('react-redux', () => ({ useSelector: (f: any) => f({ settings: {}, wallet: { btcPriceUSD: 0 } }) }));
jest.mock('../store/slices/settingsSlice', () => ({ selectMindConfig: () => ({ confirmAuthThresholdSats: 10_000 }) }));
jest.mock('../services/aiConfirm', () => ({
  formatSats: (n: number) => `${Math.round(n).toLocaleString('en-US')} sats`,
  requiresStrongAuth: () => false,
}));
jest.mock('../services/ToastService', () => ({ __esModule: true, default: { getInstance: () => ({ success: jest.fn(), error: jest.fn(), warning: jest.fn() }) } }));
jest.mock('../components/PaymentConfirmationModal', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return { __esModule: true, default: ({ visible, readback, onConfirm }: any) => visible
    ? <TouchableOpacity onPress={onConfirm}><Text>{readback.title}</Text><Text>{readback.amount}</Text></TouchableOpacity> : null };
});
jest.mock('../components', () => {
  const { Text, TouchableOpacity, View, TextInput } = require('react-native');
  return {
    ScreenHeader: ({ title }: any) => <Text>{title}</Text>,
    Badge: ({ label }: any) => <Text>{label}</Text>,
    AmountText: ({ children }: any) => <Text>{children}</Text>,
    Card: ({ children }: any) => <View>{children}</View>,
    EmptyState: ({ title }: any) => <Text>{title}</Text>,
    Callout: ({ title, message }: any) => <>{title ? <Text>{title}</Text> : null}<Text>{message}</Text></>,
    Button: ({ title, onPress, disabled }: any) => <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress}><Text>{title}</Text></TouchableOpacity>,
    Input: (props: any) => <TextInput testID={`input-${props.label}`} {...props} />,
    Sheet: ({ visible, title, children, footer }: any) => visible ? <View><Text>{title}</Text>{children}{footer}</View> : null,
  };
});

const base = {
  refresh: jest.fn(), enable: jest.fn(async () => {}), topUp: jest.fn(async () => ({ status: 'confirmed' })),
  withdraw: jest.fn(async () => ({ status: 'confirmed' })), disable: jest.fn(), savePolicy: jest.fn(async (p: any) => p),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAdvanced = true;
  Object.assign(mockHook, base, {
    state: { loading: false, enabled: true, balanceSats: 2500, policy: { ...DEFAULT_POLICY, allowedServices: ['api.example.com'] }, totals: { todaySats: 1000, monthSats: 1000 }, entries: [
      { id: '1', kind: 'spend', at: Date.now(), amountSats: 21, feeSats: 1, status: 'paid', service: 'api.example.com', reason: 'fetch_paid_resource' },
      { id: '2', kind: 'spend', at: Date.now(), amountSats: 5000, feeSats: 0, status: 'refused', service: 'big.example.org', error: 'Above the limit.' },
    ], error: null },
  });
});

test('off: explains the Agent wallet and turns it on', async () => {
  mockHook.state = { loading: false, enabled: false, balanceSats: null, policy: null, totals: null, entries: [], error: null };
  const screen = render(<AgentWalletScreen />);
  fireEvent.press(screen.getByText('Turn on Agent wallet'));
  await act(async () => {});
  expect(mockHook.enable).toHaveBeenCalled();
});

test('on: shows the balance, what is left today, rules and the spend log', () => {
  const screen = render(<AgentWalletScreen />);
  expect(screen.getByText('2,500 sats')).toBeTruthy();
  expect(screen.getByText('4,000 sats of 5,000 sats left today')).toBeTruthy();
  expect(screen.getByText('api.example.com')).toBeTruthy();
  expect(screen.getByText('Agent paid api.example.com')).toBeTruthy();
  expect(screen.getByText('Refused')).toBeTruthy();
});

test('top up goes through the confirm sheet before moving funds', async () => {
  const screen = render(<AgentWalletScreen />);
  fireEvent.press(screen.getByText('Top up'));
  fireEvent.changeText(screen.getByTestId('input-Amount (sats)'), '3000');
  fireEvent.press(screen.getByText('Review'));
  expect(mockHook.topUp).not.toHaveBeenCalled();
  expect(screen.getByText('Top up Agent wallet')).toBeTruthy();
  fireEvent.press(screen.getByText('3,000 sats'));
  await act(async () => {});
  expect(mockHook.topUp).toHaveBeenCalledWith(3000);
});

test('withdraw cannot ask for more than the balance', () => {
  const screen = render(<AgentWalletScreen />);
  fireEvent.press(screen.getByText('Withdraw'));
  fireEvent.changeText(screen.getByTestId('input-Amount (sats)'), '9999');
  fireEvent.press(screen.getByText('Review'));
  expect(screen.queryByText('Withdraw to main wallet')).toBeTruthy();
  expect(mockHook.withdraw).not.toHaveBeenCalled();
});

test('pausing saves the rules; Lite cannot edit limits', async () => {
  mockAdvanced = false;
  const screen = render(<AgentWalletScreen />);
  expect(screen.getByText(/Switch to Advanced/)).toBeTruthy();
  expect(screen.queryByText('Add')).toBeNull();
  const { Switch } = require('react-native');
  fireEvent(screen.UNSAFE_getByType(Switch), 'valueChange', true);
  await act(async () => {});
  expect(mockHook.savePolicy).toHaveBeenCalledWith(expect.objectContaining({ paused: true }));
});
