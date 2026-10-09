import { act, renderHook } from '@testing-library/react-native';

let mockStatuses: string[] = [];
const mockRefresh = jest.fn(async () => undefined);
const mockList = jest.fn(async () => mockStatuses.map((status, idx) => ({ idx, status, direction: 'incoming', kind: 'ReceiveWitness', amount: 1 })));
const mockAdapter = { protocolName: 'RGB_L1', isConnected: () => true, listTransfers: jest.fn(), account: { refreshTransfers: jest.fn() } };
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (f: any) => require('react').useEffect(f, [f]) }));
jest.mock('../services/protocols', () => ({ rgbAccountAdapter: () => mockAdapter }));
jest.mock('../services/rgbWallet', () => ({ refreshRgbTransfers: () => mockRefresh(), listRgbTransfers: () => mockList() }));

import { RGB_WATCH_INTERVAL_MS, useRgbTransferWatch } from './useRgbTransferWatch';

const originalAppState = (require('react-native') as any).AppState;
let appStateChange: (state: string) => void = () => undefined;
beforeEach(() => {
  jest.useFakeTimers(); mockRefresh.mockClear(); mockList.mockClear();
  (require('react-native') as any).AppState = { currentState: 'active', addEventListener: (_: string, cb: any) => { appStateChange = cb; return { remove: jest.fn() }; } };
});
afterEach(() => { jest.useRealTimers(); (require('react-native') as any).AppState = originalAppState; });

test('refreshes while a transfer is pending, reports each change, and stops once none is', async () => {
  mockStatuses = ['waiting-counterparty'];
  const onChange = jest.fn();
  const { result } = renderHook(() => useRgbTransferWatch({ assetId: 'rgb:a', enabled: true, onChange }));
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(result.current[0].status).toBe('waiting-counterparty');
  expect(onChange).not.toHaveBeenCalled(); // the first read is not a change

  mockStatuses = ['waiting-confirmations'];
  await act(async () => { await jest.advanceTimersByTimeAsync(RGB_WATCH_INTERVAL_MS); });
  expect(onChange).toHaveBeenCalledTimes(1);

  mockStatuses = ['settled'];
  await act(async () => { await jest.advanceTimersByTimeAsync(RGB_WATCH_INTERVAL_MS); });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(mockRefresh).toHaveBeenCalledTimes(3);

  await act(async () => { await jest.advanceTimersByTimeAsync(RGB_WATCH_INTERVAL_MS * 5); });
  expect(mockRefresh).toHaveBeenCalledTimes(3); // nothing pending: stopped
});

test('does nothing when disabled, and stops when the screen goes away', async () => {
  mockStatuses = ['waiting-counterparty'];
  const { rerender, unmount } = renderHook(({ enabled }) => useRgbTransferWatch({ assetId: 'rgb:a', enabled }), { initialProps: { enabled: false } });
  await act(async () => { await jest.advanceTimersByTimeAsync(RGB_WATCH_INTERVAL_MS * 2); });
  expect(mockRefresh).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { await jest.advanceTimersByTimeAsync(RGB_WATCH_INTERVAL_MS * 3); });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test('pauses while the app is in the background', async () => {
  mockStatuses = ['waiting-counterparty'];
  renderHook(() => useRgbTransferWatch({ assetId: 'rgb:a', enabled: true }));
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  act(() => appStateChange('background'));
  await act(async () => { await jest.advanceTimersByTimeAsync(RGB_WATCH_INTERVAL_MS * 3); });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  act(() => appStateChange('active'));
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockRefresh).toHaveBeenCalledTimes(2);
});
