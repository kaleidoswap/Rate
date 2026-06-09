/**
 * RGB / asset amount formatting.
 *
 * RGB asset balances are reported by the node in *base units* (integers); the
 * asset's `precision` says how many of those units make one whole token. So a
 * balance of 10_000_000 at precision 6 is 10 tokens. The UI must divide by
 * 10^precision before display — doing `.toFixed(precision)` on the raw base
 * units (the previous bug) showed "10000000.000000" instead of "10".
 */
export function formatAssetAmount(baseUnits: number, precision: number): string {
  const amount = Number(baseUnits) || 0;
  if (!precision) return String(amount);
  const value = amount / Math.pow(10, precision);
  // Up to `precision` decimals, trimming trailing zeros (and a dangling dot).
  return value.toFixed(precision).replace(/\.?0+$/, '');
}
