import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ProfileEditScreen from './ProfileEditScreen';

let mockState: any;
const mockUnwrap = jest.fn();
const mockDispatch = jest.fn((action: any) => ({ ...action, unwrap: () => mockUnwrap(action) }));
jest.mock('../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (fn: any) => fn(mockState),
}));
jest.mock('../store/slices/nostrSlice', () => ({
  loadNostrProfile: jest.fn(() => ({ type: 'load' })),
  restoreNostrConnection: jest.fn(() => ({ type: 'restore' })),
  updateNostrProfile: jest.fn((edits: any) => ({ type: 'update', edits })),
}));
jest.mock('../services/kaleidoswapMe', () => ({
  getStoredHandle: jest.fn(async () => ({ lightningAddress: 'me@kaleidoswap.me' })),
}));
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('../services/ToastService', () => ({ __esModule: true, default: { getInstance: () => mockToast } }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../components/ProfileAvatar', () => ({ ProfileAvatar: () => null }));
jest.mock('../components', () => {
  const { Text, TouchableOpacity, View, TextInput } = require('react-native');
  return {
    Button: ({ title, onPress, disabled }: any) => (
      <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={disabled}><Text>{title}</Text></TouchableOpacity>
    ),
    Callout: ({ message }: any) => <Text>{message}</Text>,
    EmptyState: ({ title, actionLabel, onAction }: any) => (
      <View><Text>{title}</Text><TouchableOpacity onPress={onAction}><Text>{actionLabel}</Text></TouchableOpacity></View>
    ),
    Input: ({ label, error, ...props }: any) => (
      <View><TextInput accessibilityLabel={label} {...props} />{error ? <Text>{error}</Text> : null}</View>
    ),
  };
});

const navigation = { goBack: jest.fn(), replace: jest.fn() };
const profile = { display_name: 'Satoshi', name: 'satoshi', picture: 'https://example.com/a.png', lud06: 'lnurl1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockUnwrap.mockResolvedValue(undefined);
  mockState = { nostr: { profile, publicKey: 'ab', isConnected: true }, wallet: { activeWallet: { id: 1 } } };
});

it('publishes only the fields that changed and confirms', async () => {
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.changeText(screen.getByLabelText('About'), 'Hello Nostr');
  await act(async () => { fireEvent.press(screen.getByText('Save')); });

  const update = mockDispatch.mock.calls.map(c => c[0]).find(a => a.type === 'update');
  expect(update.edits).toEqual({ about: 'Hello Nostr' });
  expect(mockToast.success).toHaveBeenCalled();
  expect(navigation.goBack).toHaveBeenCalled();
});

it('shows an error and stays open when publishing fails', async () => {
  mockUnwrap.mockImplementation(async (a: any) => { if (a.type === 'update') throw new Error('No relay accepted'); });
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.changeText(screen.getByLabelText('Display name'), 'Nakamoto');
  await act(async () => { fireEvent.press(screen.getByText('Save')); });

  expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('No relay accepted'));
  expect(mockToast.success).not.toHaveBeenCalled();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

it('blocks invalid input before publishing', async () => {
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.changeText(screen.getByLabelText('Lightning address'), 'nope');
  await act(async () => { fireEvent.press(screen.getByText('Save')); });

  expect(screen.getByText('Use the form name@domain.com')).toBeTruthy();
  expect(mockDispatch.mock.calls.some(c => c[0].type === 'update')).toBe(false);
});

it("reconnects first when Nostr is offline, and offers the wallet's Lightning address", async () => {
  mockState.nostr.isConnected = false;
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  await waitFor(() => screen.getByText(/Use my wallet's address/));
  fireEvent.press(screen.getByText(/Use my wallet's address/));
  await act(async () => { fireEvent.press(screen.getByText('Save')); });

  const types = mockDispatch.mock.calls.map(c => c[0].type);
  expect(types.indexOf('restore')).toBeGreaterThanOrEqual(0);
  expect(types.indexOf('restore')).toBeLessThan(types.indexOf('update'));
  const update = mockDispatch.mock.calls.map(c => c[0]).find(a => a.type === 'update');
  expect(update.edits).toEqual({ lud16: 'me@kaleidoswap.me' });
});

it('sends people without a Nostr identity to setup', () => {
  mockState.nostr = { profile: null, publicKey: null };
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.press(screen.getByText('Set up Nostr'));
  expect(navigation.replace).toHaveBeenCalledWith('NostrSettings');
});
