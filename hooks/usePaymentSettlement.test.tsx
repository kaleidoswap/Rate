import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  SETTLEMENT_POLL_MS,
  SETTLEMENT_TIMEOUT_MS,
  settlementFromAdapter,
  usePaymentSettlement,
} from './usePaymentSettlement';

const mockGetPaymentStatus = jest.fn();
jest.mock('../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: () => ({ getPaymentStatus: (h: string) => mockGetPaymentStatus(h) }) },
}));

const HASH = 'a'.repeat(64);

function Probe(props: { initialStatus: 'confirmed' | 'pending' | 'unknown'; paymentHash?: string }) {
  const s = usePaymentSettlement({ ...props, protocol: 'BARK' });
  return <Text>{`${s.status}|${s.timedOut}|${s.polling}`}</Text>;
}

describe('settlementFromAdapter', () => {
  it('maps adapter statuses', () => {
    expect(settlementFromAdapter({ status: 'confirmed' })).toBe('confirmed');
    expect(settlementFromAdapter({ status: 'pending' })).toBe('pending');
    expect(settlementFromAdapter({ status: 'failed' })).toBe('failed');
    expect(settlementFromAdapter({ status: 'unknown' })).toBeNull();
  });
});

describe('usePaymentSettlement', () => {
  beforeEach(() => { jest.useFakeTimers(); mockGetPaymentStatus.mockReset(); });
  afterEach(() => jest.useRealTimers());

  it('turns a pending receipt into confirmed once the payment settles (the stuck case)', async () => {
    mockGetPaymentStatus
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'confirmed' });
    const ui = render(<Probe initialStatus="pending" paymentHash={HASH} />);
    await act(async () => { await Promise.resolve(); });
    expect(ui.getByText('pending|false|true')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_POLL_MS); await Promise.resolve(); await Promise.resolve(); });
    expect(ui.getByText('confirmed|false|false')).toBeTruthy();
    expect(mockGetPaymentStatus).toHaveBeenCalledWith(HASH);
  });

  it('reports a failure the wallet confirms', async () => {
    mockGetPaymentStatus.mockResolvedValue({ status: 'failed' });
    const ui = render(<Probe initialStatus="pending" paymentHash={HASH} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(ui.getByText('failed|false|false')).toBeTruthy();
  });

  it('times out even when a status lookup never answers', async () => {
    mockGetPaymentStatus.mockReturnValue(new Promise(() => {}));
    const ui = render(<Probe initialStatus="pending" paymentHash={HASH} />);
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_TIMEOUT_MS + SETTLEMENT_POLL_MS); });
    expect(ui.getByText('pending|true|false')).toBeTruthy();
  });

  it('stops polling at the time limit instead of spinning forever', async () => {
    mockGetPaymentStatus.mockRejectedValue(new Error('unavailable'));
    const ui = render(<Probe initialStatus="unknown" paymentHash={HASH} />);
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_TIMEOUT_MS + SETTLEMENT_POLL_MS); await Promise.resolve(); });
    expect(ui.getByText('unknown|true|false')).toBeTruthy();
    const calls = mockGetPaymentStatus.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_POLL_MS * 5); });
    expect(mockGetPaymentStatus.mock.calls.length).toBe(calls);
  });

  it('does not poll without a payment hash, and settles the screen immediately', async () => {
    const ui = render(<Probe initialStatus="pending" />);
    await act(async () => { await Promise.resolve(); });
    expect(ui.getByText('pending|true|false')).toBeTruthy();
    expect(mockGetPaymentStatus).not.toHaveBeenCalled();
  });

  it('leaves confirmed receipts alone', () => {
    const ui = render(<Probe initialStatus="confirmed" paymentHash={HASH} />);
    expect(ui.getByText('confirmed|false|false')).toBeTruthy();
    expect(mockGetPaymentStatus).not.toHaveBeenCalled();
  });
});
