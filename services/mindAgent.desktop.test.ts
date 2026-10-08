import * as SecureStore from 'expo-secure-store';
import { createMindAgent } from './mindAgent';
import { __resetDesktopModelForTests } from './desktopModel';

jest.mock('./protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn(() => null) },
  kaleidoClientManager: { isInitialized: jest.fn(() => false), getClient: jest.fn() },
  flashnetClientManager: { isInitialized: jest.fn(() => false), getClient: jest.fn(), getPoolId: jest.fn() },
}));
jest.mock('../store/storeProvider', () => ({ getStore: jest.fn() }));
jest.mock('../store/slices/walletSlice', () => ({
  fetchBitcoinPrice: jest.fn(() => ({ type: 'wallet/fetchBitcoinPrice' })),
}));
jest.mock('./NostrService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
jest.mock('../utils/lnurl', () => ({ resolveLightningAddressToInvoice: jest.fn() }));
jest.mock('./btcmapService', () => ({ getUserLocation: jest.fn(), geocodeAddress: jest.fn(), findNearbyMerchants: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() },
}));

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const reply = (text: string) => ({ text, rawContent: text, toolCalls: [] });
const PROMPT = 'write a short poem about the ocean';

function fakeQvac() {
  return { runProviderTurn: jest.fn(async () => reply('from the phone')), cancelRequest: jest.fn(async () => {}) } as any;
}

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  __resetDesktopModelForTests();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({ host: '192.168.1.20', port: 47615, token: TOKEN }));
  fetchSpy = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async () =>
    ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen3.5-2b' }] }) }) as any,
  );
});
afterEach(() => fetchSpy.mockRestore());

test('with the setting on, turns run on the desktop with the user sampling settings', async () => {
  const qvac = fakeQvac();
  const remote = { name: 'remote', runTurn: jest.fn(async () => reply('from the desktop')), cancel: jest.fn(async () => {}) };
  const createRemote = jest.fn(() => remote);
  const agent = createMindAgent(qvac, () => ({ useDesktopModel: true, temperature: 0.2, maxTokens: 300 }), { createRemote });
  const res = await agent.runTurn(PROMPT);
  expect(res.text).toBe('from the desktop');
  expect(createRemote).toHaveBeenCalledWith({ baseUrl: 'http://192.168.1.20:47615/v1', apiKey: TOKEN, model: 'qwen3.5-2b' });
  expect(remote.runTurn).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.2, maxTokens: 300 }));
  expect((remote.runTurn.mock.calls[0] as any[])[0].tools.length).toBeGreaterThan(0);
  expect(qvac.runProviderTurn).not.toHaveBeenCalled();
  await agent.cancel('req-1');
  expect(remote.cancel).toHaveBeenCalledWith('req-1');
});

test('with the setting off, turns run on the phone', async () => {
  const qvac = fakeQvac();
  const createRemote = jest.fn();
  const agent = createMindAgent(qvac, () => ({ useDesktopModel: false }), { createRemote });
  expect((await agent.runTurn(PROMPT)).text).toBe('from the phone');
  expect(createRemote).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('an unreachable desktop falls back to the phone and reports it', async () => {
  fetchSpy.mockImplementation(async () => { throw new TypeError('Network request failed'); });
  const qvac = fakeQvac();
  const onDesktopFallback = jest.fn();
  const agent = createMindAgent(qvac, () => ({ useDesktopModel: true }), { createRemote: jest.fn(), onDesktopFallback });
  expect((await agent.runTurn(PROMPT)).text).toBe('from the phone');
  expect(onDesktopFallback).toHaveBeenCalledWith('unreachable');
});
