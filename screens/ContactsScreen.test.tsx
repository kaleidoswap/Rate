import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ContactsScreen from './ContactsScreen';

const mockDispatch = jest.fn((a: any) => a);
let mockState: any;
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: (f: any) => f(mockState) }));
jest.mock('../store/slices/nostrSlice', () => ({
  loadContactList: jest.fn(() => ({ type: 'load' })),
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
}));
jest.mock('../services/NostrService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
jest.mock('nostr-tools', () => ({ nip19: { npubEncode: (hex: string) => `npub1${hex}` } }));
jest.mock('../components/ProfileAvatar', () => ({ ProfileAvatar: () => null }));
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() };
jest.mock('../services/ToastService', () => ({ __esModule: true, default: { getInstance: () => mockToast } }));
jest.mock('../utils/feedback', () => ({ feedback: { select: jest.fn() } }));
jest.mock('../components', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View, TextInput } = require('react-native');
  return {
    MainHeader: ({ title, subtitle, rightAction }: any) => <View><Text>{title}</Text>{subtitle ? <Text>{subtitle}</Text> : null}{rightAction}</View>,
    Button: ({ title, onPress, disabled }: any) => <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={disabled}><Text>{title}</Text></TouchableOpacity>,
    Sheet: ({ visible, children, title, footer }: any) => (visible ? <View>{title ? <Text>{title}</Text> : null}{children}{footer}</View> : null),
    ZapModal: ({ visible, recipient, onSuccess }: any) => (visible ? (
      <TouchableOpacity onPress={() => onSuccess({ amountSats: 2100, isZap: true })}><Text>{`Zap ${recipient?.name}`}</Text></TouchableOpacity>
    ) : null),
    SegmentedTabs: ({ options, onChange }: any) => <View>{options.map((o: any) => <TouchableOpacity key={o.key} onPress={() => onChange(o.key)}><Text>{o.label}</Text></TouchableOpacity>)}</View>,
    Input: ({ label, rightIcon, ...props }: any) => <View><TextInput accessibilityLabel={label} {...props} />{rightIcon}</View>,
    CopyButton: ({ value }: any) => <Text>{`copy ${value}`}</Text>,
    PressableScale: ({ children, ...props }: any) => <TouchableOpacity {...props}>{children}</TouchableOpacity>,
  };
});

const alice = { id: 'c1', name: 'Alice', lightning_address: 'alice@getalby.com', created_at: 1, updated_at: 1, is_favorite: true };
const node = { id: 'c2', name: 'Bob node', node_pubkey: '02'.padEnd(66, 'a'), created_at: 1, updated_at: 1, is_favorite: false };
const navigation = { navigate: jest.fn(), setParams: jest.fn() };

function state(overrides: any = {}) {
  return {
    contacts: { contacts: [alice, node], searchQuery: '' },
    nostr: { isConnected: false, contacts: [] },
    chat: { unreadByPubkey: {} },
    ...overrides,
  };
}

// The global react-native mock has no SectionList: render sections inline.
(require('react-native') as any).SectionList = ({ sections, renderItem, renderSectionHeader, ListHeaderComponent, ListEmptyComponent, keyExtractor }: any) => {
  const React = require('react');
  const { View } = require('react-native');
  const Empty = ListEmptyComponent;
  return (
    <View>
      {ListHeaderComponent}
      {sections.length === 0 && Empty ? <Empty /> : null}
      {sections.map((section: any, si: number) => (
        <View key={si}>
          {renderSectionHeader({ section })}
          {section.data.map((item: any, index: number) => <React.Fragment key={keyExtractor(item)}>{renderItem({ item, index, section })}</React.Fragment>)}
        </View>
      ))}
    </View>
  );
};

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); mockState = state(); });
afterEach(() => jest.useRealTimers());

test('lists favorites first and offers Nostr when it is not connected', () => {
  const screen = render(<ContactsScreen navigation={navigation} />);
  expect(screen.getByText('2 contacts')).toBeTruthy();
  expect(screen.getByText('Favorites')).toBeTruthy();
  expect(screen.getByText('Find your friends on Nostr')).toBeTruthy();
  // One source only: no filter tabs, and no sync button without Nostr.
  expect(screen.queryByText('All · 2')).toBeNull();
  expect(screen.queryByLabelText('Sync Nostr contacts')).toBeNull();
  fireEvent.press(screen.getByLabelText('Connect Nostr'));
  expect(navigation.navigate).toHaveBeenCalledWith('NostrSettings');
});

test('Pay on a row opens the zap sheet; a node contact goes to Send', () => {
  const screen = render(<ContactsScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Pay Alice'));
  expect(screen.getByText('Zap Alice')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Pay Bob node'));
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { address: node.node_pubkey, contactName: 'Bob node' });
});

test('tapping a row opens the contact sheet with its details and actions', () => {
  const screen = render(<ContactsScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Alice, alice@getalby.com'));
  expect(screen.getByText('Lightning address')).toBeTruthy();
  expect(screen.getByText('copy alice@getalby.com')).toBeTruthy();
  expect(screen.getByText('Remove from favorites')).toBeTruthy();
  fireEvent.press(screen.getByText('Remove from favorites'));
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: 'c1' }));
  // Pay from the sheet waits for the sheet to close before opening the zap sheet.
  const pays = screen.getAllByText('Pay');
  fireEvent.press(pays[pays.length - 1]); // the sheet renders after the list
  expect(screen.queryByText('Zap Alice')).toBeNull();
  act(() => { jest.advanceTimersByTime(300); });
  expect(screen.getByText('Zap Alice')).toBeTruthy();
});

test('Nostr contacts get filters, a message button and an unfollow action', () => {
  const pubkey = 'f'.repeat(64);
  mockState = state({
    nostr: { isConnected: true, contacts: [{ pubkey, profile: { name: 'carol' } }] },
    chat: { unreadByPubkey: { [pubkey]: 3 } },
  });
  const screen = render(<ContactsScreen navigation={navigation} />);
  expect(screen.getByText('All · 3')).toBeTruthy();
  fireEvent.press(screen.getByText('Nostr · 1'));
  expect(screen.queryByText('Alice')).toBeNull();
  fireEvent.press(screen.getByLabelText('Message carol'));
  expect(navigation.navigate).toHaveBeenCalledWith('Chat', expect.objectContaining({ pubkey, name: 'carol' }));
  fireEvent.press(screen.getByLabelText(/^carol, npub1/));
  expect(screen.getByText('Message · 3')).toBeTruthy();
  expect(screen.getByText('Unfollow on Nostr')).toBeTruthy();
  expect(screen.queryByText('Delete saved contact')).toBeNull();
  // Follows can be favourited too: stored by pubkey, not on the contact.
  fireEvent.press(screen.getByText('Add to favorites'));
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'contacts/toggleNostrFavorite', payload: pubkey });
});

test('a favourite Nostr pubkey lists the follow under Favorites', () => {
  const pubkey = 'e'.repeat(64);
  mockState = state({
    contacts: { contacts: [], searchQuery: '', favoriteNostrPubkeys: [pubkey] },
    nostr: { isConnected: true, contacts: [{ pubkey, profile: { name: 'erin' } }] },
  });
  const screen = render(<ContactsScreen navigation={navigation} />);
  expect(screen.getByText('Favorites')).toBeTruthy();
  fireEvent.press(screen.getByLabelText(/^erin, npub1/));
  fireEvent.press(screen.getByText('Remove from favorites'));
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'contacts/toggleNostrFavorite', payload: pubkey });
});

test('a saved contact that is also a follow shows once, with both remove options', () => {
  const pubkey = 'd'.repeat(64);
  const saved = { id: 'c3', name: 'Dave saved', lightning_address: 'DAVE@walletofsatoshi.com', created_at: 1, updated_at: 1, is_favorite: true };
  mockState = state({
    contacts: { contacts: [alice, saved], searchQuery: '' },
    nostr: { isConnected: true, contacts: [{ pubkey, profile: { name: 'dave', lud16: 'dave@walletofsatoshi.com' } }] },
  });
  const screen = render(<ContactsScreen navigation={navigation} />);
  // All = merged count; the per-source tabs stay unmerged.
  expect(screen.getByText('All · 2')).toBeTruthy();
  expect(screen.getByText('Saved · 2')).toBeTruthy();
  expect(screen.getByText('Nostr · 1')).toBeTruthy();
  // The Nostr entry wins, carrying the saved contact's favourite.
  expect(screen.queryByText('Dave saved')).toBeNull();
  expect(screen.getByText('dave')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('dave, dave@walletofsatoshi.com'));
  expect(screen.getByText('Remove from favorites')).toBeTruthy();
  expect(screen.getByText('Unfollow on Nostr')).toBeTruthy();
  fireEvent.press(screen.getByText('Delete saved contact'));
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  buttons.find((b: any) => b.style === 'destructive').onPress();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'contacts/deleteContact', payload: 'c3' });

  // Un-starring a merged row clears the saved side's favourite as well.
  fireEvent.press(screen.getByText('Remove from favorites'));
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'contacts/toggleFavorite', payload: 'c3' });

  // The Saved filter shows the saved copy on its own.
  fireEvent.press(screen.getByText('Saved · 2'));
  expect(screen.getByText('Dave saved')).toBeTruthy();
});

test('notifications use toasts instead of alerts', async () => {
  const screen = render(<ContactsScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Add contact'));
  fireEvent.changeText(screen.getByLabelText('Address or key'), 'dave@walletofsatoshi.com');
  const adds = screen.getAllByText('Add contact'); // sheet title + footer button
  await act(async () => { fireEvent.press(adds[adds.length - 1]); });
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'contacts/addContact' }));
  expect(mockToast.success).toHaveBeenCalledWith('Contact saved');

  fireEvent.press(screen.getByLabelText('Pay Alice'));
  fireEvent.press(screen.getByText('Zap Alice'));
  expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('2,100 sats to Alice'));
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('add sheet detects the identifier and keeps Add disabled until it is recognised', () => {
  const screen = render(<ContactsScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Add contact'));
  fireEvent.changeText(screen.getByLabelText('Address or key'), 'hello');
  expect(screen.getByText('Not recognised yet')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Address or key'), 'dave@walletofsatoshi.com');
  expect(screen.getByText('Lightning address or NIP-05')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Scan QR code'));
  expect(navigation.navigate).toHaveBeenCalledWith('QRScanner', { mode: 'contact', returnScreen: 'Contacts' });
});

test('toggleNostrFavorite works on pre-v6 persisted state without the field', () => {
  const { default: reducer, toggleNostrFavorite } = jest.requireActual('../store/slices/contactsSlice');
  const legacy = { contacts: [], isLoading: false, searchQuery: '', selectedContact: null, error: null, sortBy: 'name', sortOrder: 'asc' };
  const on = reducer(legacy, toggleNostrFavorite('ABC'));
  expect(on.favoriteNostrPubkeys).toEqual(['abc']);
  expect(reducer(on, toggleNostrFavorite('abc')).favoriteNostrPubkeys).toEqual([]);
});

describe('a scanned Nostr code', () => {
  const PUBKEY = 'ab'.repeat(32);
  const scanned = `npub1${'q'.repeat(58)}`;
  const nostr = {
    resolveToPubkey: jest.fn(async () => ({ pubkey: PUBKEY })),
    getUserInfo: jest.fn(async () => ({
      npub: scanned,
      profile: { display_name: 'Dave', nip05: 'dave@example.com', about: 'Hi there', lud16: 'dave@getalby.com', picture: 'https://x/d.png' },
    })),
  };
  beforeEach(() => {
    (require('../services/NostrService').default.getInstance as jest.Mock).mockReturnValue(nostr);
  });

  async function openScanned() {
    const screen = render(<ContactsScreen navigation={navigation} route={{ params: { scannedContact: scanned } }} />);
    await act(async () => { jest.advanceTimersByTime(400); });
    return screen;
  }

  test('opens Add contact prefilled, showing their Nostr profile', async () => {
    const screen = await openScanned();
    expect(screen.getByLabelText('Address or key').props.value).toBe(scanned);
    expect(navigation.setParams).toHaveBeenCalledWith({ scannedContact: undefined });
    expect(nostr.resolveToPubkey).toHaveBeenCalledWith(scanned);
    expect(nostr.getUserInfo).toHaveBeenCalledWith(PUBKEY);
    expect(screen.getByText('Dave')).toBeTruthy();
    expect(screen.getByText('dave@example.com')).toBeTruthy();
    expect(screen.getByText('Hi there')).toBeTruthy();
  });

  test('Add contact follows them on Nostr when connected', async () => {
    const { followUser } = require('../store/slices/nostrSlice');
    followUser.mockReturnValue({ type: 'follow' });
    mockDispatch.mockImplementation((a: any) => ({ ...a, unwrap: async () => undefined }));
    mockState = state({ nostr: { isConnected: true, contacts: [] } });
    const screen = await openScanned();
    await act(async () => { fireEvent.press(screen.getAllByText('Add contact').pop()!); });
    // The profile already looked up is passed along so the new row shows at once,
    // without reloading the whole follow list.
    expect(followUser).toHaveBeenCalledWith({
      pubkey: PUBKEY, petname: undefined, profile: expect.objectContaining({ display_name: 'Dave', lud16: 'dave@getalby.com' }),
    });
    const { loadContactList } = require('../store/slices/nostrSlice');
    expect(loadContactList).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith('Following on Nostr');
    expect(screen.queryByLabelText('Address or key')).toBeNull();
    mockDispatch.mockImplementation((a: any) => a);
  });

  test('a failed follow keeps the form open and says why', async () => {
    const { followUser } = require('../store/slices/nostrSlice');
    followUser.mockReturnValue({ type: 'follow' });
    mockDispatch.mockImplementation((a: any) => ({ ...a, unwrap: async () => { throw new Error('Could not read your follow list from the relays. Try again.'); } }));
    mockState = state({ nostr: { isConnected: true, contacts: [] } });
    const screen = await openScanned();
    await act(async () => { fireEvent.press(screen.getAllByText('Add contact').pop()!); });
    expect(mockToast.error).toHaveBeenCalledWith('Could not read your follow list from the relays. Try again.');
    expect(screen.getByLabelText('Address or key')).toBeTruthy();
    expect(screen.queryByText('Adding…')).toBeNull();
    mockDispatch.mockImplementation((a: any) => a);
  });

  test('a follow shows the name the user gave them', () => {
    mockState = state({ nostr: { isConnected: true, contacts: [{ pubkey: PUBKEY, petname: 'Dad', profile: { display_name: 'Dave' } }] } });
    const screen = render(<ContactsScreen navigation={navigation} />);
    expect(screen.getByText('Dad')).toBeTruthy();
    expect(screen.queryByText('Dave')).toBeNull();
  });

  test('without Nostr connected, saves them as a contact with their key and profile', async () => {
    const screen = await openScanned();
    await act(async () => { fireEvent.press(screen.getAllByText('Add contact').pop()!); });
    const added = mockDispatch.mock.calls.map((c) => c[0]).find((a) => a.type === 'contacts/addContact');
    expect(added.payload).toEqual(expect.objectContaining({
      name: 'Dave', npub: `npub1${PUBKEY}`, lightning_address: 'dave@getalby.com', avatar_url: 'https://x/d.png',
    }));
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('Contact saved'));
  });
});
