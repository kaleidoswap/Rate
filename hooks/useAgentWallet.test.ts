import { act, renderHook } from '@testing-library/react-native';

const mockStore = { isEnabled: jest.fn(async () => true), loadPolicy: jest.fn(async () => null), entries: jest.fn(async () => []), totals: jest.fn(async () => ({ todaySats: 0, monthSats: 0 })) };
const mockClose = jest.fn(async () => {});
const mockDisable = jest.fn(async () => ({ sweptSats: 10 }));
jest.mock('../services/agentWallet/live', () => ({
  agentStore: async () => mockStore,
  openAgentAccount: async () => ({ spendableSats: async () => 10 }),
  closeAgentAccount: () => mockClose(),
  transferDeps: async () => ({}),
}));
jest.mock('../services/agentWallet/transfers', () => ({
  disableAgentWallet: () => mockDisable(),
  topUpAgentWallet: jest.fn(),
  withdrawFromAgentWallet: jest.fn(),
}));
jest.mock('../services/agentWallet/reconcile', () => ({ reconcileAgentWallet: jest.fn(async () => 0) }));
jest.mock('../services/agentWallet/account', () => ({ agentPayWallet: jest.fn(() => ({})) }));

import { useAgentWallet } from './useAgentWallet';

test('turning the Agent wallet off sweeps it and closes its account', async () => {
  const { result } = renderHook(() => useAgentWallet());
  await act(async () => {});
  await act(async () => { await result.current.disable(); });
  expect(mockDisable).toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalled();
});

test('a failed sweep keeps the account open', async () => {
  mockDisable.mockRejectedValueOnce(new Error('offline'));
  mockClose.mockClear();
  const { result } = renderHook(() => useAgentWallet());
  await act(async () => {});
  await act(async () => { await expect(result.current.disable()).rejects.toThrow('offline'); });
  expect(mockClose).not.toHaveBeenCalled();
});
