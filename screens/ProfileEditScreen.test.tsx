import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import ProfileEditScreen from './ProfileEditScreen';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
const mockNostr = { canSign: jest.fn(() => true), signEvent: jest.fn((t: any) => ({ ...t, id: 'i', pubkey: 'p', sig: 's' })) };
jest.mock('../services/NostrService', () => ({ __esModule: true, default: { getInstance: () => mockNostr } }));

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
jest.mock('../utils/feedback', () => ({ feedback: { select: jest.fn() } }));
jest.mock('../components/Sheet', () => {
  const { Text, View } = require('react-native');
  return { Sheet: ({ visible, title, children, footer }: any) => (visible ? <View><Text>{title}</Text>{children}{footer}</View> : null) };
});
jest.mock('../components/Input', () => {
  const { Text, View, TextInput } = require('react-native');
  return { Input: ({ label, error, ...props }: any) => <View><TextInput accessibilityLabel={label} {...props} />{error ? <Text>{error}</Text> : null}</View> };
});
jest.mock('../components/Button', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return { Button: ({ title, onPress, disabled }: any) => <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={disabled}><Text>{title}</Text></TouchableOpacity> };
});
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

const pickPhoto = ImagePicker.launchImageLibraryAsync as jest.Mock;
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const realFetch = global.fetch;
afterAll(() => { global.fetch = realFetch; });

beforeEach(() => {
  jest.clearAllMocks();
  mockNostr.canSign.mockReturnValue(true);
  pickPhoto.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://a.jpg', base64: JPEG_B64, fileName: 'a.jpg' }] });
  global.fetch = jest.fn(async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ url: 'https://cdn.example/new.jpg' }),
  })) as any;
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

const savedEdits = async (screen: any) => {
  await act(async () => { fireEvent.press(screen.getByText('Save')); });
  return mockDispatch.mock.calls.map(c => c[0]).find(a => a.type === 'update')?.edits;
};
const chooseFromLibrary = async (screen: any, target: string) => {
  fireEvent.press(screen.getByLabelText(target));
  fireEvent.press(screen.getByText('Choose a photo'));
  await waitFor(() => expect(pickPhoto).toHaveBeenCalled());
  await waitFor(() => expect(mockToast.success.mock.calls.length + mockToast.error.mock.calls.length).toBeGreaterThan(0));
};

it('has no separate link fields: the photo and banner open one choice', () => {
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  expect(screen.queryByLabelText('Or paste a picture link')).toBeNull();
  expect(screen.queryByLabelText('Or paste a banner link')).toBeNull();
  fireEvent.press(screen.getByLabelText('Change profile photo'));
  expect(screen.getByText('Profile photo')).toBeTruthy();
  expect(screen.getByText('Choose a photo')).toBeTruthy();
  expect(screen.getByText('Paste a link')).toBeTruthy();
  expect(screen.getByText('Remove')).toBeTruthy();
  // On the screen, and in the choice where it matters.
  expect(screen.getAllByText(/uploaded to a public media server \(blossom\.primal\.net\)/)).toHaveLength(2);
});

it('offers no Remove when there is no banner yet', () => {
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Change banner'));
  expect(screen.getByText('Banner')).toBeTruthy();
  expect(screen.queryByText('Remove')).toBeNull();
});

it('uploads a chosen profile photo and publishes its link', async () => {
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  await chooseFromLibrary(screen, 'Change profile photo');

  expect(pickPhoto).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [1, 1], base64: true }));
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('https://blossom.primal.net/upload');
  expect(init.method).toBe('PUT');
  expect(init.headers['Content-Type']).toBe('image/jpeg');
  expect(init.headers.Authorization).toMatch(/^Nostr /);
  expect(mockNostr.signEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 24242, content: 'Upload a.jpg' }));
  expect(await savedEdits(screen)).toEqual({ picture: 'https://cdn.example/new.jpg' });
});

it('uses a wide crop for the banner and reconnects first when the key is not loaded', async () => {
  mockNostr.canSign.mockReturnValue(false);
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  await chooseFromLibrary(screen, 'Change banner');

  expect(pickPhoto).toHaveBeenCalledWith(expect.objectContaining({ aspect: [3, 1] }));
  expect(mockDispatch.mock.calls.some(c => c[0].type === 'restore')).toBe(true);
  expect(await savedEdits(screen)).toEqual({ banner: 'https://cdn.example/new.jpg' });
});

it('keeps the old picture and explains when the upload fails', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 401, headers: { get: () => 'auth expired' }, json: async () => ({}) })) as any;
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  await chooseFromLibrary(screen, 'Change profile photo');

  expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('auth expired'));
  expect(await savedEdits(screen)).toBeUndefined();
});

it('does nothing when the picker is cancelled', async () => {
  pickPhoto.mockResolvedValue({ canceled: true, assets: null });
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Change profile photo'));
  fireEvent.press(screen.getByText('Choose a photo'));
  await waitFor(() => expect(pickPhoto).toHaveBeenCalled());

  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
});

it('pastes a link, checking it first', async () => {
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Change profile photo'));
  fireEvent.press(screen.getByText('Paste a link'));
  expect(screen.getByLabelText('Image link').props.value).toBe(profile.picture);

  fireEvent.changeText(screen.getByLabelText('Image link'), 'not a link');
  fireEvent.press(screen.getByText('Use link'));
  expect(screen.getByText('Enter a link starting with https://')).toBeTruthy();

  fireEvent.changeText(screen.getByLabelText('Image link'), 'https://example.com/b.png');
  fireEvent.press(screen.getByText('Use link'));
  expect(screen.queryByLabelText('Image link')).toBeNull();
  expect(await savedEdits(screen)).toEqual({ picture: 'https://example.com/b.png' });
});

it('removes the photo', async () => {
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Change profile photo'));
  fireEvent.press(screen.getByText('Remove'));
  expect(screen.queryByText('Choose a photo')).toBeNull();
  expect(await savedEdits(screen)).toEqual({ picture: '' });
});

it('an odd photo link from another app does not block saving other fields', async () => {
  mockState.nostr.profile = { ...profile, picture: 'ipfs://abc' };
  const screen = render(<ProfileEditScreen navigation={navigation} />);
  fireEvent.changeText(screen.getByLabelText('About'), 'Hi');
  expect(await savedEdits(screen)).toEqual({ about: 'Hi' });
});
