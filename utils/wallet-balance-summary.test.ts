import { summarizeBitcoinBalances } from './wallet-balance-summary';

const channels = [{ local_balance_sat: 1000, outbound_balance_msat: 800000, ready: true, is_usable: true }];

describe('bitcoin balance disclosure', () => {
  it('does not count NWC Lightning funds twice', () => {
    expect(summarizeBitcoinBalances({ RGB: { confirmed: 1000, unconfirmed: 0, total: 1000 } }, channels, true))
      .toEqual({ total: 1000, available: 1000, unavailable: 0, test: 0 });
  });
  it('separates pending and locked balances from spendable funds', () => {
    expect(summarizeBitcoinBalances({
      RGB: { confirmed: 2000, unconfirmed: 300, total: 1500 },
      ARKADE: { confirmed: 4000, unconfirmed: 500, total: 4500 },
    }, channels, false)).toEqual({ total: 7800, available: 6300, unavailable: 1500, test: 0 });
  });
  it('keeps unusable channel funds in holdings without calling them available', () => {
    expect(summarizeBitcoinBalances({}, [{ ...channels[0], is_usable: false }], false))
      .toEqual({ total: 1000, available: 0, unavailable: 1000, test: 0 });
  });
});

it('keeps test-network accounts out of the total and counts mainnet Bark in it', () => {
  const balances = {
    SPARK: { confirmed: 100, unconfirmed: 0, total: 100 },
    ARKADE: { confirmed: 700, unconfirmed: 0, total: 700 },
    BARK: { confirmed: 50000, unconfirmed: 1000, total: 51000 },
  };
  expect(summarizeBitcoinBalances(balances, [], true, new Set(['SPARK', 'ARKADE'])))
    .toEqual({ total: 51000, available: 50000, unavailable: 1000, test: 800 });
  expect(summarizeBitcoinBalances({}, channels, false, new Set(['RGB'])))
    .toEqual({ total: 0, available: 0, unavailable: 0, test: 1000 });
});
