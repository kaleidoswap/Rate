import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Clipboard, Animated } from 'react-native';
import { useCameraPermissions, scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import QRScannerScreen from './QRScannerScreen';
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('react-redux', () => ({ useSelector: (cb: any) => cb({ settings: { bitcoinUnit: 'sats' } }) }));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: jest.fn(), scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => undefined } }));
jest.mock('../components/payments/InvoiceExpiry', () => ({ invoiceExpiry: jest.fn(() => null) }));
jest.mock('../utils/decodeInvoice', () => ({ decodeBolt11: jest.fn() }));
beforeEach(() => {
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

test.each(['lno1testoffer', 'LIGHTNING:lno1testoffer', 'bitcoin:?lno=lno1testoffer'])('automatically routes %s to KaleidoPay', async code => {
  (Clipboard.getString as jest.Mock).mockResolvedValue(code);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('KaleidoPay', { code });
});
test('a Lightning invoice scanned from KaleidoPay still goes to the regular Send flow', async () => {
  (require('../utils/decodeInvoice').decodeBolt11 as jest.Mock).mockReturnValue({ amountSats: 1000, description: 'Coffee' });
  (Clipboard.getString as jest.Mock).mockResolvedValue('lnbc1000testinvoice');
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} route={{ params: { returnScreen: 'KaleidoPay' } }} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', expect.objectContaining({ isLightning: true, prefilledAddress: 'lnbc1000testinvoice' }));
});


test('a universal request with a Lightning invoice opens the ordinary payment review', async () => {
  (require('../utils/decodeInvoice').decodeBolt11 as jest.Mock).mockReturnValue({ amountSats: 1000, description: 'Coffee' });
  (Clipboard.getString as jest.Mock).mockResolvedValue('bitcoin:?lightning=lnbc1000testinvoice');
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', expect.objectContaining({ isLightning: true, prefilledAddress: 'lnbc1000testinvoice' }));
});
test('a Spark-only universal request preserves its native address and amount', async () => {
  const address = `spark1${'q'.repeat(32)}`;
  (Clipboard.getString as jest.Mock).mockResolvedValue(`bitcoin:?spark=${address}&amount=0.00001`);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const screen = render(<QRScannerScreen navigation={navigation} />);
  await act(async () => { fireEvent.press(screen.getByText('Paste')); });
  expect(navigation.navigate).toHaveBeenCalledWith('Send', expect.objectContaining({ prefilledAddress: address, prefilledAmount: '1000', paymentType: 'spark' }));
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
