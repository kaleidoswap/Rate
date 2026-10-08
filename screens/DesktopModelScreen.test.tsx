import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import DesktopModelScreen from './DesktopModelScreen';

const mockDispatch = jest.fn();
let mockConfig = { useDesktopModel: false };
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: () => mockConfig,
}));
jest.mock('../store/slices/settingsSlice', () => ({
  selectMindConfig: jest.fn(),
  setMindConfig: (patch: unknown) => ({ type: 'settings/setMindConfig', payload: patch }),
}));
jest.mock('../components', () => {
  const { Text, Pressable, View } = require('react-native');
  return {
    ScreenHeader: ({ title }: any) => <Text>{title}</Text>,
    Button: ({ title, onPress }: any) => <Pressable onPress={onPress}><Text>{title}</Text></Pressable>,
    Callout: ({ title, message }: any) => <View><Text>{title}</Text><Text>{message}</Text></View>,
    Sheet: ({ visible, children }: any) => (visible ? <View>{children}</View> : null),
  };
});
const mockLoad = jest.fn();
const mockSave = jest.fn(async () => {});
const mockForget = jest.fn(async () => {});
jest.mock('../services/desktopModel', () => {
  const actual = jest.requireActual('../services/desktopModel');
  return {
    ...actual,
    loadPairing: () => mockLoad(),
    savePairing: (p: unknown) => mockSave(p),
    forgetPairing: () => mockForget(),
    refreshDesktopHealth: jest.fn(async () => null),
  };
});

const PAIRING = { host: '192.168.1.20', port: 47615, token: 'abcdefghijklmnopqrstuvwxyz012345', model: 'Qwen3.5 2B', name: 'Studio Mac' };
const nav = () => ({ navigate: jest.fn(), setParams: jest.fn(), goBack: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig = { useDesktopModel: false };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

test('unpaired: shows the privacy notice and keeps the toggle off and disabled', async () => {
  mockLoad.mockResolvedValue(null);
  const screen = render(<DesktopModelScreen navigation={nav()} />);
  await act(async () => {});
  expect(screen.getByText(/without encryption/)).toBeTruthy();
  const toggle = screen.getByLabelText('Use desktop model');
  expect(toggle.props.value).toBe(false);
  expect(toggle.props.disabled).toBe(true);
  expect(screen.queryByText('Forget desktop')).toBeNull();
});

test('paired: shows host and model, and asks before turning on', async () => {
  mockLoad.mockResolvedValue(PAIRING);
  const screen = render(<DesktopModelScreen navigation={nav()} />);
  await act(async () => {});
  expect(screen.getByText('192.168.1.20:47615')).toBeTruthy();
  expect(screen.getByText('Qwen3.5 2B')).toBeTruthy();
  expect(screen.queryByText(PAIRING.token)).toBeNull();
  fireEvent(screen.getByLabelText('Use desktop model'), 'valueChange', true);
  expect(Alert.alert).toHaveBeenCalledWith('Use desktop model?', expect.stringContaining('without encryption'), expect.any(Array));
  expect(mockDispatch).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  act(() => buttons.find((b: any) => b.text === 'Use desktop model').onPress());
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'settings/setMindConfig', payload: { useDesktopModel: true } });
});

test('scan button opens the scanner in pairing mode', async () => {
  mockLoad.mockResolvedValue(null);
  const navigation = nav();
  const screen = render(<DesktopModelScreen navigation={navigation} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Scan pairing QR'));
  expect(navigation.navigate).toHaveBeenCalledWith('QRScanner', { mode: 'pairing' });
});

test('a scanned code is confirmed before it is saved', async () => {
  mockLoad.mockResolvedValue(null);
  const raw = JSON.stringify({ type: 'kaleido-mind-remote', v: 1, ...PAIRING, tls: false });
  const navigation = nav();
  render(<DesktopModelScreen navigation={navigation} route={{ params: { scannedPairing: raw } }} />);
  await act(async () => {});
  expect(navigation.setParams).toHaveBeenCalledWith({ scannedPairing: undefined });
  expect(mockSave).not.toHaveBeenCalled();
  const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('Pair with this desktop?');
  expect(message).not.toContain(PAIRING.token);
  await act(async () => buttons.find((b: any) => b.text === 'Pair').onPress());
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ host: '192.168.1.20', port: 47615 }));
});

test('forget turns the setting off and removes the pairing', async () => {
  mockLoad.mockResolvedValue(PAIRING);
  mockConfig = { useDesktopModel: true };
  const screen = render(<DesktopModelScreen navigation={nav()} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Forget desktop'));
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => buttons.find((b: any) => b.text === 'Forget').onPress());
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'settings/setMindConfig', payload: { useDesktopModel: false } });
  expect(mockForget).toHaveBeenCalled();
});
