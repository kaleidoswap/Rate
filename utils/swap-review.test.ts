import { minimumSwapOutput, quoteHasExpired, swapOutputUsdValue } from './swap-review';
import { BTC_ASSET_PUBKEY, USDB_TOKEN_ADDRESS } from './flashnet';
import type { SwapQuote } from '../store/slices/swapSlice';

describe('swap review protection', () => {
  it('uses integer base units for the displayed and submitted 5% minimum', () => {
    expect(minimumSwapOutput(123456, 500)).toBe(117283);
    expect(minimumSwapOutput(100000000, 500)).toBe(95000000);
  });
  it('never submits an unprotected zero minimum for a tiny output', () => {
    expect(minimumSwapOutput(1, 500)).toBe(1);
  });
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid or imprecise outputs: %s', value => {
    expect(() => minimumSwapOutput(value, 500)).toThrow();
  });
  it.each([-1, 10000, NaN, 1.5])('rejects invalid slippage: %s', value => {
    expect(() => minimumSwapOutput(1000, value)).toThrow();
  });
  it('rejects quotes at expiry, including invalid timestamps', () => {
    expect(quoteHasExpired(1000, 999)).toBe(false);
    expect(quoteHasExpired(1000, 1000)).toBe(true);
    expect(quoteHasExpired(NaN)).toBe(true);
  });
});

test('values only the exact mainnet assets recognized by the portfolio', () => {
  const quote: SwapQuote = {
    rfq_id: 'q', from_asset: 'BTC', to_asset: 'USDB', from_amount: 1000, to_amount: 2,
    fee_amount: 0, exchange_rate: 0, expiry_timestamp: 1, maker_pubkey: '', venue: 'flashnet',
    to_asset_id: USDB_TOKEN_ADDRESS.mainnet,
  };
  expect(swapOutputUsdValue(quote, 'sats', undefined, 'mainnet')).toBe(2);
  expect(swapOutputUsdValue({ ...quote, to_asset_id: '3206c93b24a4d18ea19d0a9a213204af2c7e74a6d16c7535cc5d33eca4ad1eca' }, 'sats', undefined, 'mainnet')).toBe(2);
  expect(swapOutputUsdValue({ ...quote, to_asset_id: 'fake-usdb' }, 'sats', 50_000, 'mainnet')).toBeUndefined();
  expect(swapOutputUsdValue({ ...quote, venue: 'kaleidoswap' }, 'sats', 50_000, 'mainnet')).toBeUndefined();
  expect(swapOutputUsdValue(quote, 'sats', 50_000, 'regtest')).toBeUndefined();
  expect(swapOutputUsdValue(quote, 'sats', 50_000, undefined)).toBeUndefined();
  const btc = { ...quote, to_asset: 'BTC', to_asset_id: BTC_ASSET_PUBKEY, to_amount: 5000 };
  expect(swapOutputUsdValue(btc, 'sats', 50_000, 'mainnet')).toBe(2.5);
  expect(swapOutputUsdValue({ ...btc, to_asset_id: 'fake-btc' }, 'sats', 50_000, 'mainnet')).toBeUndefined();
});
