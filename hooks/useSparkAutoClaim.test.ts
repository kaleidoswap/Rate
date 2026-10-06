import { renderHook, waitFor } from '@testing-library/react-native';

const mockAdapter: any = {};
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => mockAdapter } }));
jest.mock('../utils/receive-session', () => ({ runReceiveOperation: (_l: string, fn: () => Promise<unknown>) => fn() }));
import { useSparkAutoClaim } from './useSparkAutoClaim';

beforeEach(() => {
  mockAdapter.sweepSparkL1Deposits = jest.fn(async () => ({ addressesChecked: 1, claimedTxids: ['old-tx'], errors: [] }));
  mockAdapter.claimSparkL1Deposit = jest.fn(async () => ({ status: 'claimed', txids: ['new-tx'] }));
});

test('sweeps old deposits and claims the address on screen with the adapter’s real methods', async () => {
  jest.useFakeTimers();
  const onClaimed = jest.fn();
  renderHook(() => useSparkAutoClaim({ address: 'bc1qdeposit', enabled: true, onClaimed }));
  await waitFor(() => expect(mockAdapter.sweepSparkL1Deposits).toHaveBeenCalled());
  await jest.advanceTimersByTimeAsync(10_000); // first claim poll
  jest.useRealTimers();
  await waitFor(() => expect(mockAdapter.claimSparkL1Deposit).toHaveBeenCalledWith({ address: 'bc1qdeposit' }));
  await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(expect.objectContaining({ layer: 'spark', status: 'claimed' })));
});

test('does nothing without a Spark deposit address', async () => {
  renderHook(() => useSparkAutoClaim({ address: null, enabled: true, onClaimed: jest.fn() }));
  await new Promise((r) => setTimeout(r, 20));
  expect(mockAdapter.claimSparkL1Deposit).not.toHaveBeenCalled();
  expect(mockAdapter.sweepSparkL1Deposits).not.toHaveBeenCalled();
});
