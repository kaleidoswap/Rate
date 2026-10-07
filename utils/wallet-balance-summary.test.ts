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

describe('progressive and per-network balances', () => {
  const { withProtocolBalance, bitcoinByNetwork } = require('./wallet-balance-summary');
  it('updates one account and keeps the rest', () => {
    const start = withProtocolBalance(null, 'SPARK', { confirmed: 100, unconfirmed: 0, total: 100 });
    const next = withProtocolBalance(start, 'ARKADE', { confirmed: 50, unconfirmed: 10, total: 60 });
    expect(next.byProtocol).toEqual({ SPARK: { confirmed: 100, unconfirmed: 0, total: 100 }, ARKADE: { confirmed: 50, unconfirmed: 10, total: 60 } });
    expect(next.vanilla).toEqual({ settled: 150, future: 160, spendable: 150 });
    const updated = withProtocolBalance(next, 'SPARK', { confirmed: 0, unconfirmed: 0, total: 0 });
    expect(updated.vanilla.settled).toBe(50);
  });
  it('splits bitcoin by network like the balance card', () => {
    const b = { RGB: { confirmed: 700, unconfirmed: 0, total: 700 }, SPARK: { confirmed: 5, unconfirmed: 1, total: 6 } };
    expect(bitcoinByNetwork(b, channels, false)).toEqual({ onchain: 700, lightning: 1000, spark: 6 });
    expect(bitcoinByNetwork(b, channels, true)).toEqual({ lightning: 700, spark: 6 });
  });
});

describe('a plain Lightning wallet beside RGB on this phone', () => {
  const { summarizeBitcoinBalances, bitcoinByNetwork } = require('./wallet-balance-summary');
  const balances = {
    RGB: { confirmed: 1000, unconfirmed: 0, total: 1000 },
    LN: { confirmed: 500, unconfirmed: 0, total: 500 },
  };

  it('counts the Lightning wallet in the total and as spendable', () => {
    expect(summarizeBitcoinBalances(balances, [], false)).toMatchObject({ total: 1500, available: 1500 });
  });

  it('shows it as Lightning in the breakdown', () => {
    expect(bitcoinByNetwork(balances, [], false)).toMatchObject({ onchain: 1000, lightning: 500 });
  });
});
