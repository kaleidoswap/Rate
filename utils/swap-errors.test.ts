import { describeSwapFailure, isConnectionFailure } from './swap-errors';

describe('describeSwapFailure', () => {
  it.each([
    ['API Error (400): Insufficient liquidity for this pair', 'Not enough liquidity'],
    ['Failed to init swap: maker inventory too low', 'Not enough liquidity'],
    ['Quote has expired', 'Quote expired'],
    ['API Error (404): RFQ not found', 'Quote expired'],
    ['This quote is no longer available. Refresh and review again.', 'Quote expired'],
    ['API Error (400): Pair BTC/XAUT is not active', 'Pair unavailable'],
    ['API Error (404): Pair not found', 'Pair unavailable'],
    ['API Error (400): amount below minimum', 'Amount too small'],
    ['API Error (400): amount exceeds maximum', 'Amount too large'],
    ['No route found to the maker', "Lightning couldn't carry it"],
    ['fetch failed', 'Connection problem'],
    ['Swap verification failed — the returned terms did not match your quote.', 'Swap stopped for your safety'],
    ['KaleidoSwap needs your RGB Lightning node. Connect it in Settings.', 'RGB Lightning node not connected'],
    ['Provider connection changed. Refresh and review a new quote.', 'Provider reconnected'],
  ])('%s → %s', (message, title) => {
    expect(describeSwapFailure(new Error(message)).title).toBe(title);
  });

  it('reads SDK error codes', () => {
    expect(describeSwapFailure(Object.assign(new Error('Bad request'), { code: 'PAIR_NOT_FOUND' })).title).toBe('Pair unavailable');
    expect(describeSwapFailure(Object.assign(new Error('Oops'), { code: 'INSUFFICIENT_BALANCE' })).title).toBe('Not enough balance');
    expect(describeSwapFailure(Object.assign(new Error('Request failed'), { code: 'NETWORK_ERROR' })).title).toBe('Connection problem');
  });

  it('keeps the channel-liquidity reason, capitalized', () => {
    expect(describeSwapFailure(new Error("Can't swap: your channels can send at most 101,000 sats.")))
      .toEqual({ title: 'Not enough channel liquidity', message: 'Your channels can send at most 101,000 sats.' });
  });

  it('falls back to generic copy and never shows the raw error', () => {
    const copy = describeSwapFailure(new Error('SDK_ERROR 0x1f: unexpected token < in JSON'));
    expect(copy.title).toBe('Swap failed');
    expect(copy.message).not.toMatch(/JSON|SDK_ERROR/);
    expect(describeSwapFailure(undefined).title).toBe('Swap failed');
    expect(describeSwapFailure('Insufficient liquidity').title).toBe('Not enough liquidity');
  });

  it('tells transport failures apart from refusals', () => {
    expect(isConnectionFailure(new Error('Request timed out'))).toBe(true);
    expect(isConnectionFailure(Object.assign(new Error('Request failed'), { code: 'NETWORK_ERROR' }))).toBe(true);
    expect(isConnectionFailure(new Error('Insufficient liquidity'))).toBe(false);
    expect(isConnectionFailure(undefined)).toBe(false);
  });
});
