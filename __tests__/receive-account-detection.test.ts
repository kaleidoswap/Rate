beforeAll(() => { (require('react-native') as any).AppState = { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) }; });
import { renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { ReceiveMethod } from '../utils/receive-session';

const mockAdapter = {
  isConnected: () => true,
  getBtcBalance: jest.fn(),
  getAssetBalance: jest.fn(),
  getInvoiceStatus: jest.fn(),
  listAssets: jest.fn(),
};
const mockOnchain = jest.fn();
jest.mock('light-bolt11-decoder', () => ({ decode: () => ({ sections: [{ name: 'payment_hash', value: 'a'.repeat(64) }] }) }));
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => mockAdapter } }));
jest.mock('../services/BarkService', () => ({ syncBarkForUpdates: async () => {}, readBarkOnchain: () => mockOnchain() }));
import { useDepositDetection } from '../hooks/useDepositDetection';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (AppState as any).currentState = 'active';
  AppState.addEventListener = jest.fn(() => ({ remove: jest.fn() }));
  mockAdapter.getBtcBalance.mockResolvedValue({ total: 100 });
  mockAdapter.getInvoiceStatus.mockResolvedValue({ status: 'Pending' });
});
afterEach(() => jest.useRealTimers());
const method = (overrides: Partial<ReceiveMethod>): ReceiveMethod => ({
  key: 'receive', value: 'request', label: 'Receive', protocol: 'SPARK', kind: 'address',
  layer: 'spark', monitor: 'balance', assetId: 'BTC', ...overrides,
});

it.each(['SPARK', 'ARKADE', 'BARK', 'RGB'] as const)('detects a native balance receive on %s once', async protocol => {
  const onDetected = jest.fn();
  const { unmount } = renderHook(() => useDepositDetection({ enabled: true, methods: [method({ protocol })], onDetected }));
  await jest.advanceTimersByTimeAsync(0);
  expect(onDetected).not.toHaveBeenCalled();
  mockAdapter.getBtcBalance.mockResolvedValue({ total: 125 });
  await jest.advanceTimersByTimeAsync(24000);
  expect(onDetected).toHaveBeenCalledTimes(1);
  unmount();
});

it.each(['SPARK', 'RGB'] as const)('detects settled Lightning invoices on %s without a balance increase', async protocol => {
  const onDetected = jest.fn();
  const { unmount } = renderHook(() => useDepositDetection({ enabled: true, methods: [method({ protocol, layer: 'lightning', monitor: 'invoice', kind: 'invoice' })], onDetected }));
  await jest.advanceTimersByTimeAsync(0);
  expect(onDetected).not.toHaveBeenCalled();
  mockAdapter.getInvoiceStatus.mockResolvedValue({ status: 'Succeeded' });
  await jest.advanceTimersByTimeAsync(8000);
  expect(onDetected).toHaveBeenCalledWith(expect.objectContaining({ protocol, status: 'confirmed' }));
  unmount();
});

it('watches the separate Bark on-chain wallet and waits for confirmation', async () => {
  const onDetected = jest.fn();
  mockOnchain.mockResolvedValue({ confirmedSats: 0, pendingSats: 0 });
  const { unmount } = renderHook(() => useDepositDetection({ enabled: true, methods: [method({ protocol: 'BARK', layer: 'onchain' })], onDetected }));
  await jest.advanceTimersByTimeAsync(0);
  mockOnchain.mockResolvedValue({ confirmedSats: 0, pendingSats: 500 });
  await jest.advanceTimersByTimeAsync(8000);
  expect(onDetected).not.toHaveBeenCalled();
  mockOnchain.mockResolvedValue({ confirmedSats: 500, pendingSats: 0 });
  await jest.advanceTimersByTimeAsync(8000);
  expect(onDetected).toHaveBeenCalledTimes(1);
  expect(mockAdapter.getBtcBalance).not.toHaveBeenCalled();
  unmount();
});

it('detects first-time USD tokens on Spark without mistaking BTC for USD', async () => {
  const onDetected = jest.fn();
  mockAdapter.listAssets.mockResolvedValue([{ id: 'BTC', ticker: 'BTC', balance: { total: 100 } }]);
  const { unmount } = renderHook(() => useDepositDetection({ enabled: true, methods: [method({ assetId: 'USD' })], onDetected }));
  await jest.advanceTimersByTimeAsync(0);
  mockAdapter.listAssets.mockResolvedValue([{ id: 'BTC', ticker: 'BTC', balance: { total: 500 } }]);
  await jest.advanceTimersByTimeAsync(8000);
  expect(onDetected).not.toHaveBeenCalled();
  mockAdapter.listAssets.mockResolvedValue([{ id: 'usd-token', ticker: 'USDT', balance: { total: 1000000 } }]);
  await jest.advanceTimersByTimeAsync(8000);
  expect(onDetected).toHaveBeenCalledTimes(1);
  unmount();
});

it('checks Bark Lightning by payment hash', async () => {
  const saved = mockAdapter.getInvoiceStatus;
  const status = jest.fn().mockResolvedValue({ status: 'pending' });
  (mockAdapter as any).getInvoiceStatus = undefined;
  (mockAdapter as any).getPaymentStatus = status;
  const onDetected = jest.fn();
  const { unmount } = renderHook(() => useDepositDetection({ enabled: true, methods: [method({ protocol: 'BARK', layer: 'lightning', kind: 'invoice', monitor: 'invoice' })], onDetected }));
  await jest.advanceTimersByTimeAsync(0);
  expect(onDetected).not.toHaveBeenCalled();
  status.mockResolvedValue({ status: 'complete' });
  await jest.advanceTimersByTimeAsync(8000);
  expect(status.mock.calls[0][0]).toBe('a'.repeat(64));
  expect(onDetected).toHaveBeenCalledTimes(1);
  unmount();
  mockAdapter.getInvoiceStatus = saved;
  delete (mockAdapter as any).getPaymentStatus;
});

it('detects a receive after spending reduced the monitored balance', async () => {
  const onDetected = jest.fn();
  const { unmount } = renderHook(() => useDepositDetection({ enabled: true, methods: [method({})], onDetected }));
  await jest.advanceTimersByTimeAsync(0);
  mockAdapter.getBtcBalance.mockResolvedValue({ total: 20 });
  await jest.advanceTimersByTimeAsync(8000);
  mockAdapter.getBtcBalance.mockResolvedValue({ total: 30 });
  await jest.advanceTimersByTimeAsync(8000);
  expect(onDetected).toHaveBeenCalledTimes(1);
  unmount();
});
