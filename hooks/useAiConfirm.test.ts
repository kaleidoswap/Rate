import { act, renderHook } from '@testing-library/react-native';
import { useAiConfirm } from './useAiConfirm';
import { refreshSwapQuoteForConfirm, describeSwapQuote } from '../services/swapTools';
import { previewSendPayment } from '../services/walletTools';

jest.mock('../services/swapTools', () => ({ describeSwapQuote: jest.fn(), refreshSwapQuoteForConfirm: jest.fn() }));
jest.mock('../services/walletTools', () => ({ previewSendPayment: jest.fn(), lightningRailLabel: () => 'Lightning' }));

const quote = (receive: number) => ({
  quoteId: 'q1', venue: 'kaleidoswap', from: 'BTC', to: 'USDT', sendAmount: 100_000, receiveAmount: receive,
  receiveUnit: 'USDT', expiresAt: Date.now() + 30_000,
});
const swapCall = { name: 'execute_swap', arguments: { quote_id: 'q1' } };

describe('useAiConfirm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (describeSwapQuote as jest.Mock).mockReturnValue(quote(73));
  });

  it('declines with the reason when the call cannot be prepared', async () => {
    (previewSendPayment as jest.Mock).mockRejectedValueOnce(new Error('No contact named "Al".'));
    const { result } = renderHook(() => useAiConfirm({ thresholdSats: 50_000 }));
    let decision: any;
    await act(async () => { decision = await result.current.request({ name: 'send_payment', arguments: { to: 'Al' } }); });
    expect(decision).toEqual({ approved: false, reason: 'No contact named "Al".' });
    expect(result.current.state).toBeNull();
  });

  it('holds approval when the re-quote moved past the tolerance, then accepts the re-approved price', async () => {
    (refreshSwapQuoteForConfirm as jest.Mock)
      .mockResolvedValueOnce({ quote: quote(73), refreshed: false, move: 0, needsReapproval: false })
      .mockResolvedValueOnce({ quote: quote(71), refreshed: true, move: 0.027, needsReapproval: true })
      .mockResolvedValueOnce({ quote: quote(71), refreshed: false, move: 0, needsReapproval: false });
    const onOpen = jest.fn();
    const { result } = renderHook(() => useAiConfirm({ thresholdSats: 50_000, onOpen }));
    let pending!: Promise<any>;
    await act(async () => { pending = result.current.request(swapCall); });
    expect(result.current.state?.requireAuth).toBe(true);

    await act(async () => { await result.current.approve(); });
    expect(result.current.state?.readback.warning).toMatch(/moved 2.7% against you/);
    expect(result.current.state?.readback.rows[1].value).toBe('71 USDT');
    expect(result.current.state?.loading).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(2);

    await act(async () => { await result.current.approve(); });
    await expect(pending).resolves.toEqual({ approved: true });
    expect(result.current.state?.loading).toBe(true);

    act(() => result.current.onToolResult({ name: 'execute_swap' }));
    expect(result.current.state).toBeNull();
  });

  it('cancel declines and closes', async () => {
    (refreshSwapQuoteForConfirm as jest.Mock).mockResolvedValue({ quote: quote(73), refreshed: false, move: 0, needsReapproval: false });
    const { result } = renderHook(() => useAiConfirm({ thresholdSats: 1_000_000 }));
    let pending!: Promise<any>;
    await act(async () => { pending = result.current.request(swapCall); });
    expect(result.current.state?.requireAuth).toBe(false);
    act(() => result.current.cancel());
    await expect(pending).resolves.toEqual({ approved: false, reason: 'cancelled by user' });
    expect(result.current.state).toBeNull();
  });
});
