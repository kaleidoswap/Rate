import { summarizeBitcoinBalances } from './wallet-balance-summary';

const channels = [{ local_balance_sat: 1000, outbound_balance_msat: 800000, ready: true, is_usable: true }];

describe('bitcoin balance disclosure', () => {
  it('does not count NWC Lightning funds twice', () => {
    expect(summarizeBitcoinBalances({ RGB: { confirmed: 1000, unconfirmed: 0, total: 1000 } }, channels, true))
      .toEqual({ total: 1000, available: 1000, unavailable: 0 });
  });
  it('separates pending and locked balances from spendable funds', () => {
    expect(summarizeBitcoinBalances({
      RGB: { confirmed: 2000, unconfirmed: 300, total: 1500 },
      ARKADE: { confirmed: 4000, unconfirmed: 500, total: 4500 },
    }, channels, false)).toEqual({ total: 7800, available: 6300, unavailable: 1500 });
  });
  it('keeps unusable channel funds in holdings without calling them available', () => {
    expect(summarizeBitcoinBalances({}, [{ ...channels[0], is_usable: false }], false))
      .toEqual({ total: 1000, available: 0, unavailable: 1000 });
  });
});

it('keeps the separate Bark test account out of the combined wallet total', () => {
  expect(summarizeBitcoinBalances({
    SPARK: { confirmed: 100, unconfirmed: 0, total: 100 },
    BARK: { confirmed: 50000, unconfirmed: 1000, total: 51000 },
  }, [], true)).toEqual({ total: 100, available: 100, unavailable: 0 });
});
