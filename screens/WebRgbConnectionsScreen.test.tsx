import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  disconnectWalletConnect, onWalletConnectChange, restoreWalletConnect, walletConnectError, walletConnectSessions,
} from '../services/webrgb/walletConnect';
import WebRgbConnectionsScreen from './WebRgbConnectionsScreen';

jest.mock('../services/webrgb/walletConnect', () => ({
  disconnectWalletConnect: jest.fn(), onWalletConnectChange: jest.fn(), restoreWalletConnect: jest.fn(),
  walletConnectError: jest.fn(), walletConnectSessions: jest.fn(),
}));
jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ t: (value: string) => value }) }));
jest.mock('../components', () => ({
  Button: jest.requireActual<typeof import('../components/Button')>('../components/Button').Button,
  MainHeader: () => null,
}));

const mint = { topic: 'mint-topic', name: 'Mint', url: 'https://mint.example' };
const mosaik = { topic: 'mosaik-topic', name: 'Mosaik', url: 'https://mosaik.example' };
const unsubscribe = jest.fn();
const navigate = jest.fn();
type ScreenProps = React.ComponentProps<typeof WebRgbConnectionsScreen>;

function openScreen(params?: ScreenProps['route']['params']) {
  return render(<WebRgbConnectionsScreen
    navigation={{ navigate, goBack: jest.fn() } as unknown as ScreenProps['navigation']}
    route={{ name: 'WebRgbConnections', key: 'webrgb', params }}
  />);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(walletConnectSessions).mockReturnValue([]);
  jest.mocked(walletConnectError).mockReturnValue(null);
  jest.mocked(onWalletConnectChange).mockReturnValue(unsubscribe);
  jest.mocked(restoreWalletConnect).mockResolvedValue(undefined);
  jest.mocked(disconnectWalletConnect).mockResolvedValue(undefined);
});

test('waits after pairing and replaces the waiting state with the restored session origin', () => {
  const view = openScreen({ pairing: true });
  expect(restoreWalletConnect).toHaveBeenCalledTimes(1);
  expect(view.getByText('Waiting for the app to request a connection.')).toBeTruthy();
  const [notify] = jest.mocked(onWalletConnectChange).mock.calls[0];
  jest.mocked(walletConnectSessions).mockReturnValue([mosaik]);
  act(notify);
  expect(view.queryByText('Waiting for the app to request a connection.')).toBeNull();
  expect(view.getByText(mosaik.name)).toBeTruthy();
  expect(view.getByText(mosaik.url)).toBeTruthy();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('opens the QR scanner from the empty connections list', () => {
  const view = openScreen();
  expect(view.getByText('No WebRGB apps connected.')).toBeTruthy();
  fireEvent.press(view.getByText('Scan WalletConnect QR'));
  expect(navigate).toHaveBeenCalledWith('QRScanner');
});

test('disconnects the selected topic once and retains the other session', async () => {
  jest.mocked(walletConnectSessions).mockReturnValue([mint, mosaik]);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  jest.mocked(disconnectWalletConnect).mockReturnValueOnce(pending);
  const view = openScreen();
  fireEvent.press(view.getAllByLabelText('Disconnect')[1]);
  fireEvent.press(view.getAllByLabelText('Disconnect')[0]);
  expect(disconnectWalletConnect).toHaveBeenCalledTimes(1);
  expect(disconnectWalletConnect).toHaveBeenCalledWith(mosaik.topic);
  await act(async () => { finish(); await pending; });
  jest.mocked(walletConnectSessions).mockReturnValue([mint]);
  act(jest.mocked(onWalletConnectChange).mock.calls[0][0]);
  expect(view.getByText(mint.url)).toBeTruthy();
  expect(view.queryByText(mosaik.url)).toBeNull();
});

test('displays a restore failure in place of the pairing wait', async () => {
  jest.mocked(restoreWalletConnect).mockRejectedValueOnce(new Error('relay unavailable'));
  const view = openScreen({ pairing: true });
  expect(await view.findByText('Could not restore WalletConnect sessions.')).toBeTruthy();
  expect(view.queryByText('Waiting for the app to request a connection.')).toBeNull();
});

test('keeps a session available to retry when disconnect fails', async () => {
  jest.mocked(walletConnectSessions).mockReturnValue([mint]);
  jest.mocked(disconnectWalletConnect).mockRejectedValueOnce(new Error('could not save'));
  const view = openScreen();
  fireEvent.press(view.getByText('Disconnect'));
  expect(await view.findByText('Could not disconnect this app. Try again.')).toBeTruthy();
  expect(view.getByText(mint.url)).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('Disconnect')); });
  expect(disconnectWalletConnect).toHaveBeenCalledTimes(2);
});
