import { routeSpendable } from './payment-balance';
test('never counts unconfirmed funds or substitutes a missing account', () => {
  expect(routeSpendable({ confirmed: 100, total: 1000 }, 'RGB', 'bitcoin_l1', [])).toBe(100);
  expect(routeSpendable(undefined, 'SPARK', 'lightning', [])).toBe(0);
});
test('Lightning uses usable outbound channel liquidity, never on-chain balance', () => {
  const balance = { confirmed: 100000, total: 100000 };
  const channels = [{ ready: true, is_usable: true, local_balance_sat: 1000, outbound_balance_msat: 800000, next_outbound_htlc_limit_msat: 600000 }, { ready: false, is_usable: true, local_balance_sat: 5000, outbound_balance_msat: 5000000 }];
  expect(routeSpendable(balance, 'RGB', 'lightning', channels)).toBe(600);
  expect(routeSpendable(balance, 'RGB', 'lightning', channels, true)).toBe(100000);
});
