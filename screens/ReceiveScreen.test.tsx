import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import type { InventoryAsset } from '../utils/asset-inventory';
import ReceiveScreen from './ReceiveScreen';

const mockRgbCode = 'rgb:invoice-for-selected-contract';
const mockSparkCode = 'spark1addressfixtureforselectedasset';
const mockArkadeCode = 'tark1addressfixtureforarkade';
const mockLightningCode = 'lntb1arkadeholdinvoicefixture';
const mockRgbInvoice = jest.fn(async () => ({ invoice: mockRgbCode }));
const mockSparkAddress = jest.fn(async () => ({ address: mockSparkCode }));
const mockSparkInvoice = jest.fn();
const mockArkadeAddress = jest.fn(async (): Promise<{ address?: string }> => ({ address: mockArkadeCode }));
const mockBoardingAddress = jest.fn(async () => ({}));
const mockReceive = jest.fn(async (_options: unknown, _sats: number) => ({
  invoice: mockLightningCode, rfqId: 'fee-bearing-rfq', amountSats: 10_000, payAmountSats: 10_101,
  provider: 'Maker', expiresAt: Math.floor(Date.now() / 1000) + 20,
}));
const mockClaim = jest.fn(async (_wallet: unknown, _url: string, _rfqId: string): Promise<string> => 'prepared');
const mockDetection = jest.fn();
const mockDispatch = jest.fn();
let mockConnected: Record<'RGB' | 'SPARK' | 'ARKADE', boolean>;
let mockAssets: InventoryAsset[];

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (select: (state: object) => unknown) => select({ settings: { disclosureLevel: 'lite' }, wallet: {}, nostr: {} }),
}));
jest.mock('../store/slices/settingsSlice', () => ({ selectDisclosureLevel: () => 'lite', setLastBtcReceiveRoute: jest.fn() }));
jest.mock('../store/slices/assetsSlice', () => ({ refreshRgbAssets: jest.fn() }));
jest.mock('../hooks/useFeature', () => ({ useFeature: () => false }));
jest.mock('../hooks/useFiatRates', () => ({ useFiatRates: () => ({}) }));
jest.mock('../hooks/useAssetInventory', () => ({ useAssetInventory: () => mockAssets }));
jest.mock('../hooks/useProtocol', () => ({ useRefreshableProtocolStatus: () => () => ({ ...mockConnected, BARK: false }) }));
jest.mock('../hooks/useDepositDetection', () => ({ useDepositDetection: (options: object) => { mockDetection(options); } }));
jest.mock('../hooks/useSparkAutoClaim', () => ({ useSparkAutoClaim: jest.fn() }));
jest.mock('../services/protocols', () => ({
  rgbAccountAdapter: () => ({ protocolName: 'RGB_L1', isConnected: () => mockConnected.RGB, createRgbInvoice: mockRgbInvoice }),
  rgbAccountIsOnDevice: () => mockConnected.RGB,
  protocolManager: { getAdapterIfAvailable: (key: string) => ({
    SPARK: { isConnected: () => mockConnected.SPARK, getReceiveAddress: mockSparkAddress, createInvoice: mockSparkInvoice },
    ARKADE: { isConnected: () => mockConnected.ARKADE, getReceiveAddress: mockArkadeAddress, getBoardingAddress: mockBoardingAddress },
  })[key as 'SPARK' | 'ARKADE'] },
}));
jest.mock('../services/protocols/wdk', () => ({ isRgbConnecting: () => false, subscribeRgbConnecting: () => () => {} }));
jest.mock('../services/protocols/rgbL1', () => ({ rgbLibModule: () => ({ supportsBfa: () => false }) }));
jest.mock('../services/protocols/rgbBackup', () => {
  const status = { state: 'idle' };
  return { rgbBackupStatus: () => status, onRgbBackupStatus: () => () => {}, runRgbBackup: jest.fn() };
});
jest.mock('../services/kaleidoPay/connect', () => ({
  arkadeReceiveOptions: () => ({ wallet: {}, arkServerUrl: 'https://arkade.invalid' }),
  receiveAccountChain: () => 'mutinynet',
}));
jest.mock('../services/kaleidoPay/arkadeIntents', () => ({
  createArkadeLightningReceive: (opts: unknown, sats: number) => mockReceive(opts, sats),
  claimArkadeLightningReceive: (wallet: unknown, url: string, rfqId: string) => mockClaim(wallet, url, rfqId),
}));
jest.mock('../services/contactHistory', () => ({ contactKeyFor: jest.fn(), recordContactEvent: jest.fn() }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../components/receive/MyAddressPanel', () => ({ MyAddressPanel: () => null }));
jest.mock('../components/receive/ReceiveQr', () => ({
  ReceiveQr: ({ value }: { value: string }) => {
    const { Text } = require('react-native');
    return <Text testID="receive-qr">{value}</Text>;
  },
}));
jest.mock('../components/receive/ReceiveRoutePicker', () => ({
  ReceiveRoutePicker: ({ onLightningDestination }: { onLightningDestination: (account: string) => void }) => {
    const { Text } = require('react-native');
    return <Text onPress={() => onLightningDestination('ARKADE')}>Choose Arkade Lightning</Text>;
  },
}));
jest.mock('../components/rgb/RgbUtxoSheet', () => ({ RgbUtxoSheet: () => null }));
jest.mock('../components/NostrContactsSelector', () => () => null);
jest.mock('../components/DepositSuccessOverlay', () => () => null);

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => {}) };
const rgbToken = { asset_id: 'rgb:correct', ticker: 'USD', name: 'USD RGB', protocol: 'RGB' as const };
const sparkToken = { asset_id: 'btkn1correct', ticker: 'USD', name: 'USD Spark', protocol: 'SPARK' as const };
const tokenBalance = { precision: 6, balance: 20, isNativeBtc: false };
const generate = () => act(async () => { await jest.advanceTimersByTimeAsync(450); });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockConnected = { RGB: false, SPARK: false, ARKADE: false };
  mockAssets = [];
  require('react-native').AppState = { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) };
});
afterEach(() => jest.useRealTimers());

test('uses the exact asset ID and native account from Asset Detail, including a repeated ticker', async () => {
  mockConnected.RGB = true;
  mockConnected.SPARK = true;
  mockAssets = [{ ...rgbToken, ...tokenBalance, asset_id: 'rgb:other' }, { ...sparkToken, ...tokenBalance }];
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { selectedAsset: rgbToken, prefilledAssetTicker: 'USD' } }} />);
  await generate();
  expect(mockRgbInvoice).toHaveBeenCalledWith(expect.objectContaining({ asset_id: rgbToken.asset_id }));
  expect(mockSparkAddress).not.toHaveBeenCalled();
  expect(ui.getByText(mockRgbCode)).toBeTruthy();

  ui.rerender(<ReceiveScreen navigation={navigation} route={{ params: { selectedAsset: sparkToken, prefilledAmountSat: 1000 } }} />);
  expect(ui.queryByText(mockRgbCode)).toBeNull();
  await generate();
  expect(mockSparkAddress).toHaveBeenCalledWith('SPARK');
  expect(mockSparkInvoice).not.toHaveBeenCalled();
  expect(ui.getByText(mockSparkCode)).toBeTruthy();
  expect(mockDetection).toHaveBeenLastCalledWith(expect.objectContaining({
    methods: [expect.objectContaining({ assetId: sparkToken.asset_id, layer: 'spark' })],
  }));
});

test('an offline token route does not create a Bitcoin request with a different connected account', async () => {
  mockConnected.SPARK = true;
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { selectedAsset: rgbToken } }} />);
  await generate();
  expect(mockRgbInvoice).not.toHaveBeenCalled();
  expect(mockSparkAddress).not.toHaveBeenCalled();
  expect(ui.getByText('Connect the RGB account to receive this asset.')).toBeTruthy();
});

async function openArkadeRequest() {
  mockConnected.ARKADE = true;
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { prefilledAmountSat: 10_000 } }} />);
  fireEvent.press(ui.getByLabelText(/Change receive options/));
  fireEvent.press(ui.getByText('Choose Arkade Lightning'));
  await generate();
  return ui;
}

test('shares the fee-bearing Arkade Lightning invoice separately and leaves the Bitcoin request payable after expiry', async () => {
  const ui = await openArkadeRequest();
  const codes = ui.getAllByTestId('receive-qr').map(qr => qr.props.children as string);
  const payment = new URL(codes[0]);
  expect(payment.searchParams.get('amount')).toBe('0.0001');
  expect(payment.searchParams.get('ark')).toBe(mockArkadeCode);
  expect(payment.searchParams.get('lightning')).toBeNull();
  expect(codes[1]).toBe(mockLightningCode);
  expect(mockClaim).toHaveBeenCalledWith({}, 'https://arkade.invalid', 'fee-bearing-rfq');
  expect(mockDetection).toHaveBeenLastCalledWith(expect.objectContaining({
    methods: expect.arrayContaining([expect.objectContaining({ layer: 'lightning', value: mockLightningCode, monitor: 'none' })]),
  }));
  await act(async () => { fireEvent.press(ui.getByLabelText('Share Arkade Lightning invoice')); });
  expect(Share.share).toHaveBeenCalledWith({
    title: 'Arkade Lightning invoice',
    message: `${(10_101).toLocaleString()} sats via Lightning · ${(10_000).toLocaleString()} sats received in Arkade\n${mockLightningCode}`,
  });

  await act(async () => { await jest.advanceTimersByTimeAsync(21_000); });
  expect(ui.queryByLabelText('Share Arkade Lightning invoice')).toBeNull();
  expect(ui.getByLabelText('Share Payment request')).toBeTruthy();
});

test('keeps the standalone Arkade invoice monitored when no Bitcoin address can be offered', async () => {
  mockArkadeAddress.mockResolvedValueOnce({});
  const ui = await openArkadeRequest();
  expect(ui.getByTestId('receive-qr').props.children).toBe(mockLightningCode);
  expect(ui.queryByLabelText('Share Payment request')).toBeNull();
  expect(ui.getByLabelText('Share Arkade Lightning invoice')).toBeTruthy();
  expect(mockClaim).toHaveBeenCalledWith({}, 'https://arkade.invalid', 'fee-bearing-rfq');
});

test('keeps the Bitcoin request available when the separate maker invoice fails', async () => {
  mockClaim.mockResolvedValueOnce('failed');
  const ui = await openArkadeRequest();
  await act(async () => { await Promise.resolve(); });
  expect(ui.getByText('This Lightning invoice could not be completed.')).toBeTruthy();
  expect(ui.queryByLabelText('Share Arkade Lightning invoice')).toBeNull();
  expect(ui.getByLabelText('Share Payment request')).toBeTruthy();
});

test('leaves an Arkade Lightning invoice in the universal QR when it has the same amount', async () => {
  mockReceive.mockResolvedValueOnce({
    invoice: mockLightningCode, rfqId: 'no-fee-rfq', amountSats: 10_000, payAmountSats: 10_000,
    provider: 'Maker', expiresAt: Math.floor(Date.now() / 1000) + 20,
  });
  const ui = await openArkadeRequest();
  const payment = new URL(ui.getByTestId('receive-qr').props.children as string);
  expect(payment.searchParams.get('lightning')).toBe(mockLightningCode);
  expect(payment.searchParams.get('amount')).toBe('0.0001');
  expect(ui.queryByLabelText('Share Arkade Lightning invoice')).toBeNull();
});
