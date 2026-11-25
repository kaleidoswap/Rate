import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import type { InventoryAsset } from '../utils/asset-inventory';
import ReceiveScreen from './ReceiveScreen';

const mockRgbCode = 'rgb:invoice-for-selected-contract';
const mockSparkCode = 'spark1addressfixtureforselectedasset';
const mockArkadeCode = 'tark1addressfixtureforarkade';
const mockLightningCode = 'lntb1arkadeholdinvoicefixture';
const mockRgbInvoice = jest.fn(async (_params: object): Promise<{ invoice: string; expiration_timestamp?: number }> => ({ invoice: mockRgbCode }));
const mockRgbLightningInvoice = jest.fn(async () => ({ invoice: 'lntb1-rgb-asset-invoice-fixture' }));
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
const mockDepositOverlay = jest.fn();
const mockDispatch = jest.fn();
let mockConnected: Record<'RGB' | 'SPARK' | 'ARKADE', boolean>;
let mockAssets: InventoryAsset[];
let mockRemoteRgb: boolean;
let mockRgbChain = 'mutinynet';
let mockBfa = false;
let mockMintBridge = false;

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
  rgbAccountIsOnDevice: () => mockConnected.RGB && !mockRemoteRgb,
  protocolManager: { getAdapterIfAvailable: (key: string) => ({
    SPARK: { isConnected: () => mockConnected.SPARK, getReceiveAddress: mockSparkAddress, createInvoice: mockSparkInvoice },
    ARKADE: { isConnected: () => mockConnected.ARKADE, getReceiveAddress: mockArkadeAddress, getBoardingAddress: mockBoardingAddress },
    RGB_LN: { isConnected: () => mockConnected.RGB && mockRemoteRgb, createInvoice: mockRgbLightningInvoice, listChannels: async () => [{ is_usable: true }] },
  })[key as 'SPARK' | 'ARKADE' | 'RGB_LN'] },
}));
jest.mock('../services/protocols/wdk', () => ({ isRgbConnecting: () => false, subscribeRgbConnecting: () => () => {} }));
jest.mock('../services/protocols/rgbL1', () => ({ rgbLibModule: () => ({ supportsBfa: () => mockBfa }) }));
jest.mock('../services/protocols/rgbBackup', () => {
  const status = { state: 'idle' };
  return { rgbBackupStatus: () => status, onRgbBackupStatus: () => () => {}, runRgbBackup: jest.fn() };
});
jest.mock('../services/protocols/rgbOnlineOptions', () => ({
  rgbOnlineOptions: () => mockMintBridge ? { evmChains: { '42161': {} } } : undefined,
}));
jest.mock('../services/kaleidoPay/connect', () => ({
  arkadeReceiveOptions: () => ({ wallet: {}, arkServerUrl: 'https://arkade.invalid' }),
  receiveAccountChain: () => mockRgbChain,
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
  ReceiveRoutePicker: ({ onLightningDestination, onMethod }: { onLightningDestination: (account: string) => void; onMethod: (method: string) => void }) => {
    const { Text } = require('react-native');
    return <>
      <Text onPress={() => onLightningDestination('ARKADE')}>Choose Arkade Lightning</Text>
      <Text onPress={() => onMethod('lightning')}>Choose RGB Lightning</Text>
    </>;
  },
}));
jest.mock('../components/rgb/RgbUtxoSheet', () => ({ RgbUtxoSheet: () => null }));
jest.mock('../components/NostrContactsSelector', () => () => null);
jest.mock('../components/DepositSuccessOverlay', () => (props: object) => { mockDepositOverlay(props); return null; });

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => {}) };
const rgbToken = { asset_id: 'rgb:correct', ticker: 'USD', name: 'USD RGB', protocol: 'RGB' as const };
const sparkToken = { asset_id: 'btkn1correct', ticker: 'USD', name: 'USD Spark', protocol: 'SPARK' as const };
const tokenBalance = { precision: 6, balance: 20, isNativeBtc: false };
const generate = () => act(async () => { await jest.advanceTimersByTimeAsync(450); });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockRgbChain = 'mutinynet';
  mockBfa = false; mockMintBridge = false;
  mockRgbInvoice.mockReset().mockResolvedValue({ invoice: mockRgbCode });
  mockConnected = { RGB: false, SPARK: false, ARKADE: false };
  mockAssets = [];
  mockRemoteRgb = false;
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

test('switches from a generated Any RGB QR to an exact held asset on the same screen', async () => {
  mockConnected.RGB = true;
  mockAssets = [{ ...rgbToken, ...tokenBalance }, { ...sparkToken, ...tokenBalance }];
  const ui = render(<ReceiveScreen navigation={navigation} />);
  fireEvent.press(ui.getByLabelText('Choose an RGB asset'));
  fireEvent.press(ui.getByRole('radio', { name: /Any RGB asset/ }));
  await generate();
  expect(mockRgbInvoice.mock.calls[0][0]).not.toHaveProperty('asset_id');
  expect(mockRgbInvoice.mock.calls[0][0]).not.toHaveProperty('amount');
  expect(ui.getByText(mockRgbCode)).toBeTruthy();
  expect(ui.queryByPlaceholderText('Any amount')).toBeNull();
  expect(ui.getByText('Any amount')).toBeTruthy();

  fireEvent.press(ui.getByLabelText('Change RGB asset, Any RGB asset'));
  expect(ui.getByRole('radio', { name: /Any RGB asset/, checked: true })).toBeTruthy();
  fireEvent.press(ui.getByRole('radio', { name: /USD.*USD RGB/ }));
  expect(ui.queryByText(mockRgbCode)).toBeNull();
  expect(ui.queryByLabelText('Share RGB invoice')).toBeNull();
  await generate();
  expect(mockRgbInvoice).toHaveBeenLastCalledWith(expect.objectContaining({ asset_id: rgbToken.asset_id }));
  expect(ui.getByLabelText('Change RGB asset, USD RGB')).toBeTruthy();
  expect(ui.getByLabelText('Amount (USD)')).toBeTruthy();
});

test('applies the exact RGB amount and inline settings together, clearing stale QR and actions first', async () => {
  mockConnected.RGB = true;
  mockAssets = [{ ...rgbToken, ...tokenBalance }];
  const updated = 'rgb:invoice-updated-with-options';
  mockRgbInvoice.mockResolvedValueOnce({ invoice: mockRgbCode }).mockResolvedValueOnce({ invoice: updated });
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { selectedAsset: rgbToken } }} />);
  await generate();
  expect(ui.getByLabelText('Copy RGB invoice')).toBeTruthy();
  expect(ui.getByRole('button', { name: 'Invoice options, Standard, 1 hour, 1 confirmation', expanded: false })).toBeTruthy();
  expect(ui.getAllByLabelText('Payment network: Mutinynet')).toHaveLength(1);

  const viewOrder = JSON.stringify(ui.toJSON());
  const elementPositions = ['Change RGB asset, USD RGB', 'Payment network: Mutinynet', 'Amount (USD)', 'receive-qr',
    'Share RGB invoice', 'Copy RGB invoice', 'Invoice options'].map(label => viewOrder.indexOf(label));
  expect(elementPositions.every(position => position >= 0)).toBe(true);
  expect(elementPositions).toEqual([...elementPositions].sort((a, b) => a - b));

  const input = ui.getByLabelText('Amount (USD)');
  fireEvent.changeText(input, '1.0000001');
  expect(ui.queryByTestId('receive-qr')).toBeNull();
  expect(ui.queryByLabelText('Copy RGB invoice')).toBeNull();
  expect(ui.queryByLabelText('Share RGB invoice')).toBeNull();
  expect(ui.getByLabelText('Update invoice').props.accessibilityState.disabled).toBe(true);
  await generate();
  expect(mockRgbInvoice).toHaveBeenCalledTimes(1);

  fireEvent.changeText(input, '1,250001');
  fireEvent.press(ui.getByRole('button', { name: /Invoice options/ }));
  fireEvent.press(ui.getByLabelText('Private'));
  fireEvent.press(ui.getByLabelText('1 day'));
  fireEvent.press(ui.getByLabelText('3 blocks'));
  fireEvent.press(ui.getByLabelText('Update invoice'));
  await generate();
  expect(mockRgbInvoice).toHaveBeenLastCalledWith({ asset_id: rgbToken.asset_id,
    amount: 1_250_001, witness: false, duration_seconds: 86_400, min_confirmations: 3 });
  expect(ui.getByText(updated)).toBeTruthy();
  expect(ui.getByText('Private · 1 day · 3 confirmations')).toBeTruthy();
});

test('a late RGB invoice never replaces a different asset request', async () => {
  mockConnected.RGB = true;
  mockAssets = [{ ...rgbToken, ...tokenBalance }];
  let finishOldInvoice: (invoice: { invoice: string }) => void = () => {};
  mockRgbInvoice.mockImplementationOnce(() => new Promise(resolve => { finishOldInvoice = resolve; }));
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { selectedAsset: rgbToken } }} />);
  await generate();
  expect(mockRgbInvoice).toHaveBeenLastCalledWith(expect.objectContaining({ asset_id: rgbToken.asset_id }));

  fireEvent.press(ui.getByLabelText('Change RGB asset, USD RGB'));
  fireEvent.press(ui.getByRole('radio', { name: /Any RGB asset/ }));
  await generate();
  await act(async () => { finishOldInvoice({ invoice: 'rgb:stale-invoice-from-old-asset' }); });
  expect(ui.getByText(mockRgbCode)).toBeTruthy();
  expect(ui.queryByText('rgb:stale-invoice-from-old-asset')).toBeNull();
});

test('an RGB Lightning request uses asset units and keeps expiry inline without on-chain settings', async () => {
  mockConnected.RGB = true;
  mockRemoteRgb = true;
  mockAssets = [{ ...rgbToken, ...tokenBalance }];
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { selectedAsset: rgbToken } }} />);
  await generate();
  fireEvent.press(ui.getByLabelText(/Change receive network/));
  fireEvent.press(ui.getByText('Choose RGB Lightning'));
  await generate();
  expect(ui.getByRole('button', { name: 'Invoice options, 1 hour', expanded: false })).toBeTruthy();
  fireEvent.press(ui.getByRole('button', { name: /Invoice options/ }));
  expect(ui.queryByText('Invoice type')).toBeNull();
  expect(ui.queryByText('Confirmations')).toBeNull();
  fireEvent.changeText(ui.getByLabelText('Amount (USD)'), '0.000001');
  fireEvent.press(ui.getByLabelText('10 min'));
  fireEvent.press(ui.getByLabelText('Update invoice'));
  await generate();
  expect(mockRgbLightningInvoice).toHaveBeenLastCalledWith({ asset: rgbToken.asset_id, assetAmount: 1, expirySeconds: 600, description: 'Receive USD' });
});

test('hides an expired RGB QR and its copy/share actions using the returned deadline', async () => {
  mockConnected.RGB = true;
  mockRgbInvoice.mockResolvedValueOnce({ invoice: mockRgbCode, expiration_timestamp: Math.floor(Date.now() / 1000) + 3 });
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { selectedAsset: rgbToken } }} />);
  await generate();
  expect(ui.getByLabelText('Share RGB invoice')).toBeTruthy();
  await act(async () => { await jest.advanceTimersByTimeAsync(3_000); });
  expect(ui.getByText('Invoice expired. Create a new request.')).toBeTruthy();
  expect(ui.queryByText(mockRgbCode)).toBeNull();
  expect(ui.queryByLabelText('Share RGB invoice')).toBeNull();
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

test('the Utexo Mint preset issues an amountless public Signet invoice valid for one day', async () => {
  mockConnected.RGB = true;
  mockRgbChain = 'signet'; mockBfa = true; mockMintBridge = true;
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { rgbInvoicePreset: 'utexoMint' } }} />);
  await generate();
  expect(mockRgbInvoice).toHaveBeenCalledWith({ duration_seconds: 86_400, min_confirmations: 1 });
  expect(ui.getByLabelText('Copy RGB invoice')).toBeTruthy();
});

const signetUsdt = 'rgb:uVMNCuVU-U00Y_wv-6~7ZbW7-tEuUMcE-pB0wDzC-nt7Qsdc';
test.each([
  [signetUsdt, 'Utexo USDT'],
  ['rgb:A6Nr_ndv-Cx_t3_i-YfPXoL6-pT8ibp3-CR6LH5q-fQvTsp8', 'RGB asset'],
  ['rgb:other', 'RGB asset'],
])('the Mint receipt identifies what was actually received: %s', async (assetId, ticker) => {
  mockConnected.RGB = true;
  mockRgbChain = 'signet'; mockBfa = true; mockMintBridge = true;
  mockAssets = [{ ...rgbToken, ...tokenBalance, ticker: 'USDT', asset_id: assetId }];
  render(<ReceiveScreen navigation={navigation} route={{ params: { rgbInvoicePreset: 'utexoMint' } }} />);
  await generate();
  expect(mockRgbInvoice).toHaveBeenCalledWith({
    duration_seconds: 86_400, min_confirmations: 1, ...(assetId === signetUsdt ? { asset_id: signetUsdt } : {}),
  });
  act(() => mockDetection.mock.lastCall[0].onDetected({ status: 'confirmed', protocol: 'RGB', layer: 'rgb', amount: 1, assetId }));
  expect(mockDepositOverlay).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, ticker, rgbContract: assetId }));
});

test('the Utexo Mint preset cannot issue an invoice on Mutinynet', async () => {
  mockConnected.RGB = true;
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { rgbInvoicePreset: 'utexoMint' } }} />);
  await generate();
  expect(mockRgbInvoice).not.toHaveBeenCalled();
  expect(ui.queryByLabelText('Copy RGB invoice')).toBeNull();
});

test('a build missing the Arbitrum bridge configuration cannot offer a mint invoice', async () => {
  mockConnected.RGB = true;
  mockRgbChain = 'signet'; mockBfa = true;
  const ui = render(<ReceiveScreen navigation={navigation} route={{ params: { rgbInvoicePreset: 'utexoMint' } }} />);
  await generate();
  expect(mockRgbInvoice).not.toHaveBeenCalled();
  expect(ui.queryByLabelText('Copy RGB invoice')).toBeNull();
});
