import { formatSwapPrice, swapRateLabel } from './swap-model';

describe('formatSwapPrice', () => {
  it('groups thousands with two decimals from 1 up', () => {
    expect(formatSwapPrice(62345.678)).toBe('62,345.68');
    expect(formatSwapPrice(1000)).toBe('1,000');
    expect(formatSwapPrice(1.5)).toBe('1.50');
  });

  it('keeps six significant digits below 1', () => {
    expect(formatSwapPrice(0.5)).toBe('0.5');
    expect(formatSwapPrice(0.000016023456)).toBe('0.0000160235');
  });

  it('shows 0 for unusable values', () => {
    expect(formatSwapPrice(0)).toBe('0');
    expect(formatSwapPrice(NaN)).toBe('0');
    expect(formatSwapPrice(Infinity)).toBe('0');
  });
});

describe('swapRateLabel', () => {
  it('prices BTC → asset per whole BTC when the unit is sats', () => {
    expect(swapRateLabel({ from_asset: 'BTC', to_asset: 'USDT', from_amount: 100_000, to_amount: 62.5 }, 'sats'))
      .toBe('1 BTC ≈ 62,500 USDT');
  });

  it('prices BTC → asset per BTC when the unit is BTC', () => {
    expect(swapRateLabel({ from_asset: 'BTC', to_asset: 'USDT', from_amount: 0.001, to_amount: 62.5 }, 'BTC'))
      .toBe('1 BTC ≈ 62,500 USDT');
  });

  it('prices asset → BTC per BTC too', () => {
    expect(swapRateLabel({ from_asset: 'USDT', to_asset: 'BTC', from_amount: 62.5, to_amount: 100_000 }, 'sats'))
      .toBe('1 BTC ≈ 62,500 USDT');
  });

  it('prices asset pairs per unit of the asset paid', () => {
    expect(swapRateLabel({ from_asset: 'USDT', to_asset: 'XAUT', from_amount: 100, to_amount: 0.04 }, 'sats'))
      .toBe('1 USDT ≈ 0.0004 XAUT');
  });

  it('shows a dash without amounts', () => {
    expect(swapRateLabel({ from_asset: 'BTC', to_asset: 'USDT', from_amount: 0, to_amount: 1 }, 'sats')).toBe('—');
  });
});
