import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Clipboard, Animated, AppState } from 'react-native';
import { useCameraPermissions, scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import QRScannerScreen from './QRScannerScreen';
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused, useFocusEffect: (cb: any) => require('react').useEffect(() => mockFocused ? cb() : undefined, [cb, mockFocused]) }));
jest.mock('react-redux', () => ({ useSelector: (cb: any) => cb({ settings: { bitcoinUnit: 'sats' } }) }));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: jest.fn(), scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => undefined } }));
jest.mock('../services/kaleidoPay/connect', () => ({ rgbInvoiceWallet: () => null }));
jest.mock('../components/payments/InvoiceExpiry', () => ({ invoiceExpiry: jest.fn(() => null) }));
jest.mock('../utils/decodeInvoice', () => ({ decodeBolt11: jest.fn() }));
let mockAppStateChange: (state: string) => void;
beforeEach(() => {
  mockFocused = true;
  (require('react-native') as any).AppState = { currentState: 'active', addEventListener: jest.fn((_event, callback) => { mockAppStateChange = callback; return { remove: jest.fn() }; }) };
  (require('react-native') as any).Easing = { bezier: () => () => {} };
  (Animated.Value as unknown as jest.Mock).mockImplementation(() => ({ setValue: jest.fn(), stopAnimation: jest.fn(), interpolate: jest.fn() }));
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false, canAskAgain: true }, jest.fn()]);
});
afterEach(() => jest.clearAllMocks());
test('camera denial leaves paste and image entry available, without automatic permission prompts', async () => {
  const request = jest.fn(); (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false, canAskAgain: true }, request]);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} route={{ params: { mode: 'contact' } }} />);
  expect(request).not.toHaveBeenCalled(); expect(screen.getByText('Choose image')).toBeTruthy();
  (Clipboard.getString as jest.Mock).mockResolvedValue('contact-value');
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Contacts', expect.objectContaining({ scannedContact: 'contact-value' }));
});
test('image with multiple QR codes stays on scanner with a recoverable error', async () => {
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'local-image' }] });
  (scanFromURLAsync as jest.Mock).mockResolvedValue([{ data: 'a' }, { data: 'b' }]);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() }; const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Choose image')); });
  expect(screen.getByText(/More than one QR/)).toBeTruthy(); expect(navigation.navigate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Scan again')); expect(screen.queryByText(/More than one QR/)).toBeNull();
});
test('cancels late clipboard navigation after leaving the screen and ignores double taps', async () => {
  let resolve!: (s: string) => void; (Clipboard.getString as jest.Mock).mockReturnValue(new Promise(r => { resolve = r; }));
  const navigation = { navigate: jest.fn(), goBack: jest.fn() }; const screen = render(<QRScannerScreen navigation={navigation} route={{ params: { mode: 'contact' } }} />);
  fireEvent.press(screen.getByText('Paste')); fireEvent.press(screen.getByText('Paste'));
  expect(Clipboard.getString).toHaveBeenCalledTimes(1); screen.unmount();
  await act(async () => { resolve('contact'); }); expect(navigation.navigate).not.toHaveBeenCalled();
});

const OFFER = require('@universal-bolt12/universal-code').encodeOffer([{ type: 10n, value: new TextEncoder().encode('Shop') }]);
test.each([OFFER, `LIGHTNING:${OFFER}`, `bitcoin:?lno=${OFFER}`])('opens Send with the code as-is: %s', async code => {
  (Clipboard.getString as jest.Mock).mockResolvedValue(code);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { prefilledAddress: code });
});
test('a Lightning invoice opens Send as-is', async () => {
  (require('../utils/decodeInvoice').decodeBolt11 as jest.Mock).mockReturnValue({ amountSats: 1000, description: 'Coffee' });
  (Clipboard.getString as jest.Mock).mockResolvedValue('lnbc1000testinvoice');
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { prefilledAddress: 'lnbc1000testinvoice' });
});


test('a universal request with a Lightning invoice opens Send with both legs', async () => {
  (require('../utils/decodeInvoice').decodeBolt11 as jest.Mock).mockReturnValue({ amountSats: 1000, description: 'Coffee' });
  (Clipboard.getString as jest.Mock).mockResolvedValue('bitcoin:?lightning=lnbc1000testinvoice');
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { prefilledAddress: 'bitcoin:?lightning=lnbc1000testinvoice' });
});
test('a Spark-only universal request opens Send with its address and amount', async () => {
  const address = `spark1${'q'.repeat(32)}`;
  (Clipboard.getString as jest.Mock).mockResolvedValue(`bitcoin:?spark=${address}&amount=0.00001`);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { prefilledAddress: `bitcoin:?spark=${address}&amount=0.00001` });
});
test('a token request is never silently treated as a BTC native request', async () => {
  (Clipboard.getString as jest.Mock).mockResolvedValue(`bitcoin:?spark=spark1${'q'.repeat(32)}&assetid=USD&assetamount=10`);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(screen.getByText(/not a recognized/)).toBeTruthy();
});

test.each(['lnbc-expired', 'bitcoin:?lightning=lnbc-expired'])('rejects an expired invoice before navigating: %s', async code => {
  const expiry = require('../components/payments/InvoiceExpiry').invoiceExpiry as jest.Mock;
  expiry.mockImplementation((value: string) => value === 'lnbc-expired' ? Date.now() - 1000 : null);
  (Clipboard.getString as jest.Mock).mockResolvedValue(code);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).not.toHaveBeenCalled(); expect(screen.getByText(/invoice has expired/)).toBeTruthy();
  expiry.mockReturnValue(null);
});

test.each([
  ['0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'],
  ['ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@8453', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'],
  ['So11111111111111111111111111111111111111112', 'So11111111111111111111111111111111111111112'],
])('an address on another chain opens Send for a cross-chain transfer: %s', async (code, address) => {
  (Clipboard.getString as jest.Mock).mockResolvedValue(code);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { prefilledAddress: address });
});

const NPUB = `npub1${'q'.repeat(58)}`;
test.each([NPUB, `nostr:${NPUB}`, `NOSTR:${NPUB.toUpperCase()}`, `nostr:nprofile1${'q'.repeat(70)}`])(
  "someone's Nostr code opens Add contact with their key: %s",
  async code => {
    (Clipboard.getString as jest.Mock).mockResolvedValue(code);
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const screen = render(<QRScannerScreen navigation={navigation} />);
    await act(async () => { fireEvent.press(screen.getByText('Paste')); });
    const expected = code.replace(/^nostr:/i, '').toLowerCase();
    expect(navigation.navigate).toHaveBeenCalledWith('Contacts', { scannedContact: expected });
    expect(navigation.navigate).not.toHaveBeenCalledWith('Send', expect.anything());
  },
);


test('releases the camera immediately after a payment QR, before navigation unmounts the scanner', async () => {
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  const camera = screen.UNSAFE_getByType('CameraView' as any);
  await act(async () => { await camera.props.onBarcodeScanned({ data: 'lnbc1000testinvoice' }); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { prefilledAddress: 'lnbc1000testinvoice' });
  expect(screen.UNSAFE_queryByType('CameraView' as any)).toBeNull();
});

test('releases camera on blur and background, and returns with torch off', () => {
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Turn torch on'));
  expect(screen.UNSAFE_getByType('CameraView' as any).props.enableTorch).toBe(true);
  act(() => mockAppStateChange('inactive'));
  expect(screen.UNSAFE_queryByType('CameraView' as any)).toBeNull();
  act(() => mockAppStateChange('active'));
  expect(screen.UNSAFE_getByType('CameraView' as any).props.enableTorch).toBe(false);
  mockFocused = false;
  screen.rerender(<QRScannerScreen navigation={navigation} />);
  expect(screen.UNSAFE_queryByType('CameraView' as any)).toBeNull();
  mockFocused = true;
  screen.rerender(<QRScannerScreen navigation={navigation} />);
  expect(screen.UNSAFE_getByType('CameraView' as any)).toBeTruthy();
});
