import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import ProfileScreen from './ProfileScreen';

let mockState: any;
const mockDispatch = jest.fn((a: any) => a);
jest.mock('../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (fn: any) => fn(mockState),
}));
jest.mock('../store/slices/nostrSlice', () => ({ loadNostrProfile: jest.fn(() => ({ type: 'load' })) }));
jest.mock('nostr-tools', () => ({ nip19: { npubEncode: (hex: string) => `npub1${hex}` } }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: ({ rightAction }: any) => rightAction ?? null }));
jest.mock('../components/ProfileAvatar', () => ({ ProfileAvatar: () => null }));
jest.mock('../components/receive/ReceiveQr', () => {
  const { Text } = require('react-native');
  return { ReceiveQr: ({ value }: any) => <Text testID="qr">{value}</Text> };
});
jest.mock('../components', () => {
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    Button: ({ title, onPress }: any) => <TouchableOpacity accessibilityRole="button" onPress={onPress}><Text>{title}</Text></TouchableOpacity>,
    CopyButton: ({ value, label }: any) => <Text>{`${label ?? 'copy'} ${value}`}</Text>,
    EmptyState: ({ title, actionLabel, onAction }: any) => (
      <View><Text>{title}</Text><TouchableOpacity onPress={onAction}><Text>{actionLabel}</Text></TouchableOpacity></View>
    ),
  };
});

const navigation = { navigate: jest.fn(), replace: jest.fn() };
const NPUB = 'npub1alice';
const profile = {
  display_name: 'Alice',
  name: 'alice',
  nip05: '_@alice.example',
  about: 'Bitcoin and coffee',
  lud16: 'alice@kaleidoswap.me',
  website: 'https://alice.example/blog',
  banner: 'https://alice.example/banner.png',
  picture: 'https://alice.example/a.png',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockState = { nostr: { profile, publicKey: 'ab', npub: NPUB, isConnected: true } };
});

it('shows a recap of the Nostr profile', () => {
  const screen = render(<ProfileScreen navigation={navigation} />);
  expect(screen.getByText('Alice')).toBeTruthy();
  expect(screen.getByText('@alice')).toBeTruthy();
  expect(screen.getByText('alice.example')).toBeTruthy();
  expect(screen.getByText('Bitcoin and coffee')).toBeTruthy();
  expect(screen.getByText('alice@kaleidoswap.me')).toBeTruthy();
  expect(screen.queryByText('alice.example/blog')).toBeNull();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'load' });
});

it('Edit profile opens the editor', () => {
  const screen = render(<ProfileScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Edit profile'));
  expect(navigation.navigate).toHaveBeenCalledWith('ProfileEdit');
});

it('shows the npub as a nostr: QR, with copy and share', () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  const screen = render(<ProfileScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Show Nostr QR code'));
  expect(screen.getByTestId('qr').props.children).toBe(`nostr:${NPUB}`);
  expect(screen.getByText('Friends can scan this to add you')).toBeTruthy();
  expect(screen.getByText(`Copy ${NPUB}`)).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Share'));
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(`nostr:${NPUB}`) }));
});

it('derives the npub from the public key when it was not stored', () => {
  mockState.nostr.npub = null;
  const screen = render(<ProfileScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Show Nostr QR code'));
  expect(screen.getByTestId('qr').props.children).toBe('nostr:npub1ab');
});

it('keeps the QR collapsed until requested', () => {
  const screen = render(<ProfileScreen navigation={navigation} />);
  expect(screen.queryByTestId('qr')).toBeNull();
  fireEvent.press(screen.getByLabelText('Show Nostr QR code'));
  expect(screen.getByTestId('qr')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Show Nostr QR code'));
  expect(screen.queryByTestId('qr')).toBeNull();
});

it('sends people without a Nostr identity to setup', () => {
  mockState.nostr = { profile: null, publicKey: null, npub: null };
  const screen = render(<ProfileScreen navigation={navigation} />);
  fireEvent.press(screen.getByText('Set up Nostr'));
  expect(navigation.replace).toHaveBeenCalledWith('NostrSettings');
});
