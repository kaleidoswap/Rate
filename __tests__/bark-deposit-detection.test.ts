beforeAll(() => { (require('react-native') as any).AppState = { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) }; });
import { renderHook } from '@testing-library/react-native'

// Bark's balance only changes after a sync (no daemon); model that.
let synced = 0
const mockSync = jest.fn(async () => { synced += 1 })
const mockBark = {
  isConnected: () => true,
  getBtcBalance: jest.fn(async () => ({ total: synced >= 2 ? 1500 : 1000 })),
}
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: jest.fn(() => mockBark) } }))
jest.mock('../services/BarkService', () => ({ syncBarkForUpdates: () => mockSync() }))
import { useDepositDetection } from '../hooks/useDepositDetection'

it('syncs Bark before each balance read, so an incoming Ark payment is detected', async () => {
  jest.useFakeTimers()
  const onDetected = jest.fn()
  const methods = [{ key: 'bark', label: 'Bark', protocol: 'BARK', kind: 'address', layer: 'bark', monitor: 'balance', value: 'ark1x', assetId: 'BTC' }] as any
  renderHook(() => useDepositDetection({ enabled: true, methods, onDetected }))
  await jest.advanceTimersByTimeAsync(4_000) // baseline (sync 1)
  await jest.advanceTimersByTimeAsync(8_000) // first poll (sync 2) sees the receive
  expect(mockSync.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(onDetected).toHaveBeenCalledWith(expect.objectContaining({ layer: 'bark', status: 'confirmed', protocol: 'BARK', assetId: 'BTC', amount: 500, amountSource: 'balance' }))
  jest.useRealTimers()
})

it('checks immediately after backgrounding without resetting the receive baseline', async () => {
  jest.useFakeTimers();
  const { AppState } = require('react-native');
  let change!: (state: string) => void;
  const remove = jest.fn();
  AppState.addEventListener.mockImplementation((_event: string, fn: any) => { change = fn; return { remove }; });
  synced = 0;
  const onDetected = jest.fn();
  const methods = [{ key: 'bark', label: 'Bark', protocol: 'BARK', kind: 'address', layer: 'bark', monitor: 'balance', value: 'ark1x', assetId: 'BTC' }] as any;
  const { unmount } = renderHook(() => useDepositDetection({ enabled: true, methods, onDetected }));
  await jest.advanceTimersByTimeAsync(4000);
  change('background');
  await jest.advanceTimersByTimeAsync(60000);
  expect(onDetected).not.toHaveBeenCalled();
  change('active');
  await jest.advanceTimersByTimeAsync(0);
  expect(onDetected).toHaveBeenCalledTimes(1);
  unmount();
  expect(remove).toHaveBeenCalled();
  jest.useRealTimers();
});

it('retains the baseline when the receive screen loses focus and celebrates only once', async () => {
  jest.useFakeTimers();
  synced = 0;
  const onDetected = jest.fn();
  const methods = [{ key: 'bark', label: 'Bark', protocol: 'BARK', kind: 'address', layer: 'bark', monitor: 'balance', value: 'ark1x', assetId: 'BTC' }] as any;
  const { rerender, unmount } = renderHook(({ enabled }) => useDepositDetection({ enabled, methods, onDetected }), { initialProps: { enabled: true } });
  await jest.advanceTimersByTimeAsync(0);
  rerender({ enabled: false });
  await jest.advanceTimersByTimeAsync(30_000);
  expect(onDetected).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await jest.advanceTimersByTimeAsync(0);
  expect(onDetected).toHaveBeenCalledTimes(1);
  rerender({ enabled: false });
  rerender({ enabled: true });
  await jest.advanceTimersByTimeAsync(20_000);
  expect(onDetected).toHaveBeenCalledTimes(1);
  unmount();
  jest.useRealTimers();
});
