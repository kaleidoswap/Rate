import { depositAmountLabel } from './deposit-receipt';
test('formats detected sats and token atomic units', () => {
  expect(depositAmountLabel(5000, 'BTC', [])).toBe(`${(5000).toLocaleString()} sats`);
  expect(depositAmountLabel(1250000, 'usd-id', [{ asset_id: 'usd-id', ticker: 'USDT', precision: 6 }])).toBe(`${(1.25).toLocaleString()} USDT`);
});
test('does not invent an amount or token precision', () => {
  expect(depositAmountLabel(undefined, 'BTC', [])).toBeUndefined();
  expect(depositAmountLabel(NaN, 'BTC', [])).toBeUndefined();
  expect(depositAmountLabel(50, 'new-token', [])).toBeUndefined();
  expect(depositAmountLabel(50, 'new-token', [{ asset_id: 'new-token', ticker: 'NEW' }])).toBeUndefined();
});
