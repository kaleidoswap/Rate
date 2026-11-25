import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  disconnectWebRgb, onWebRgbChange, restoreWebRgb, webRgbError, webRgbSessions,
} from '../services/webrgb/nwc';
import WebRgbConnectionsScreen from './WebRgbConnectionsScreen';

jest.mock('../services/webrgb/nwc', () => ({
  disconnectWebRgb: jest.fn(), onWebRgbChange: jest.fn(), restoreWebRgb: jest.fn(),
  webRgbError: jest.fn(), webRgbSessions: jest.fn(),
}));
jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ t: (value: string) => value }) }));
jest.mock('../components', () => ({
  Button: jest.requireActual<typeof import('../components/Button')>('../components/Button').Button,
  MainHeader: () => null,
}));

let mockNetwork = 'mutinynet';
jest.mock('../services/webrgb/account', () => ({ currentWebRgbAccount: () => ({ account: { network: mockNetwork } }) }));

const other = { topic: 'client-a', name: 'Test client', url: 'nostr:' + 'a'.repeat(64) };
const mosaik = { topic: 'client-b', name: 'Mosaik', url: 'nostr:' + 'b'.repeat(64) };
const unsubscribe = jest.fn();
const navigate = jest.fn();
type ScreenProps = React.ComponentProps<typeof WebRgbConnectionsScreen>;

function openScreen() {
  return render(<WebRgbConnectionsScreen
    navigation={{ navigate, goBack: jest.fn() } as unknown as ScreenProps['navigation']}
    route={{ name: 'WebRgbConnections', key: 'webrgb' }}
  />);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(webRgbSessions).mockReturnValue([]);
  jest.mocked(webRgbError).mockReturnValue(null);
  jest.mocked(onWebRgbChange).mockReturnValue(unsubscribe);
  jest.mocked(restoreWebRgb).mockResolvedValue(undefined);
  jest.mocked(disconnectWebRgb).mockResolvedValue(undefined);
});

test('shows the authenticated client when the saved NWC connection is restored', () => {
  const view = openScreen();
  expect(restoreWebRgb).toHaveBeenCalledTimes(1);
  expect(view.getByText('No WebRGB apps connected.')).toBeTruthy();
  const [notify] = jest.mocked(onWebRgbChange).mock.calls[0];
  jest.mocked(webRgbSessions).mockReturnValue([mosaik]);
  act(notify);
  expect(view.queryByText('No WebRGB apps connected.')).toBeNull();
  expect(view.getByText(mosaik.name)).toBeTruthy();
  expect(view.getByText(mosaik.url)).toBeTruthy();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('opens the QR scanner from the empty connections list', () => {
  const view = openScreen();
  expect(view.getByText('No WebRGB apps connected.')).toBeTruthy();
  fireEvent.press(view.getByText('Scan NWC authorization QR'));
  expect(navigate).toHaveBeenCalledWith('QRScanner');
});

test('disconnects the selected topic once and retains the other session', async () => {
  jest.mocked(webRgbSessions).mockReturnValue([other, mosaik]);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  jest.mocked(disconnectWebRgb).mockReturnValueOnce(pending);
  const view = openScreen();
  fireEvent.press(view.getAllByLabelText('Disconnect')[1]);
  fireEvent.press(view.getAllByLabelText('Disconnect')[0]);
  expect(disconnectWebRgb).toHaveBeenCalledTimes(1);
  expect(disconnectWebRgb).toHaveBeenCalledWith(mosaik.topic);
  await act(async () => { finish(); await pending; });
  jest.mocked(webRgbSessions).mockReturnValue([other]);
  act(jest.mocked(onWebRgbChange).mock.calls[0][0]);
  expect(view.getByText(other.url)).toBeTruthy();
  expect(view.queryByText(mosaik.url)).toBeNull();
});

test('displays a restore failure', async () => {
  jest.mocked(restoreWebRgb).mockRejectedValueOnce(new Error('relay unavailable'));
  const view = openScreen();
  expect(await view.findByText('Could not restore NWC connections.')).toBeTruthy();
});

test('keeps a session available to retry when disconnect fails', async () => {
  jest.mocked(webRgbSessions).mockReturnValue([other]);
  jest.mocked(disconnectWebRgb).mockRejectedValueOnce(new Error('could not save'));
  const view = openScreen();
  fireEvent.press(view.getByText('Disconnect'));
  expect(await view.findByText('Could not disconnect this app. Try again.')).toBeTruthy();
  expect(view.getByText(other.url)).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('Disconnect')); });
  expect(disconnectWebRgb).toHaveBeenCalledTimes(2);
});

test('opens a prepared Utexo Mint invoice only for a public Signet wallet', () => {
  mockNetwork = 'mutinynet';
  const view = openScreen();
  fireEvent.press(view.getByText('Create Utexo Mint invoice'));
  expect(view.getByText(/Select Signet/)).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
  mockNetwork = 'signet';
  fireEvent.press(view.getByText('Create Utexo Mint invoice'));
  expect(navigate).toHaveBeenCalledWith('Receive', { rgbInvoicePreset: 'utexoMint' });
});
