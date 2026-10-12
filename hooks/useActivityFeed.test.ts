beforeAll(() => { (require('react-native') as any).AppState = { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) }; });
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}));

const adapters: Record<string, any> = {};
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: (name: string) => adapters[name] },
  rgbAccountAdapter: () => undefined,
  rgbAccountIsOnDevice: () => false,
}));

import { clearActivityCache } from '../services/ActivityService';
import { useActivityFeed } from './useActivityFeed';

const tx = (id: string) => ({ id, type: 'receive', status: 'confirmed', amount: 1, timestamp: 1, asset: { ticker: 'BTC' } });
const options = { swaps: [{ rfq_id: 'r1', status: 'completed' as const, created_at: 0 }] };

beforeEach(() => {
  for (const key of Object.keys(adapters)) delete adapters[key];
  clearActivityCache();
});

test('shows local items while accounts load, then settles', async () => {
  let resolve!: (v: any[]) => void;
  adapters.SPARK = { isConnected: () => true, listTransactions: () => new Promise((r) => { resolve = r; }) };
  const { result } = renderHook(() => useActivityFeed(options));
  expect(result.current.items.map((i) => i.id)).toEqual(['swap-r1']);
  expect(result.current.updating).toBe(true);

  await waitFor(() => expect(resolve).toBeDefined());
  await act(async () => { resolve([tx('s1')]); });
  await waitFor(() => expect(result.current.updating).toBe(false));
  expect(result.current.items.map((i) => i.id)).toEqual(['spark-s1', 'swap-r1']);
  expect(result.current.result).toMatchObject({ failedSources: 0, hadConnectedAdapter: true });
});

test('a poll does not start while a load is still running, and nothing updates after unmount', async () => {
  let resolve!: (v: any[]) => void;
  const listTransactions = jest.fn(() => new Promise<any[]>((r) => { resolve = r; }));
  adapters.SPARK = { isConnected: () => true, listTransactions };
  const { result, unmount } = renderHook(() => useActivityFeed(options, 10));
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(listTransactions).toHaveBeenCalledTimes(1);

  const shown = result.current.items;
  unmount();
  await act(async () => { resolve([tx('s1')]); });
  expect(result.current.items).toBe(shown);
});

test('refreshes immediately on return to the foreground and removes its listener', async () => {
  const { AppState } = require('react-native');
  let changed!: (state: string) => void;
  const remove = jest.fn();
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event: any, callback: any) => { changed = callback; return { remove }; });
  const listTransactions = jest.fn(async () => [tx('s1')]);
  adapters.SPARK = { isConnected: () => true, listTransactions };
  const { result, unmount } = renderHook(() => useActivityFeed(options));
  await waitFor(() => expect(result.current.updating).toBe(false));
  const before = listTransactions.mock.calls.length;
  await act(async () => { changed('active'); });
  await waitFor(() => expect(listTransactions.mock.calls.length).toBe(before + 1));
  unmount();
  expect(remove).toHaveBeenCalled();
  listener.mockRestore();
});
