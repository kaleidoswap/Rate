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

export type AssetBalanceLike =
  | number
  | {
      spendable?: number;
      available?: number;
      settled?: number;
      total?: number;
      future?: number;
      pending?: number;
      offchain_outbound?: number;
      offchain_inbound?: number;
    }
  | null
  | undefined;

export function getAssetBaseUnitBalance(balance: AssetBalanceLike): number {
  if (typeof balance === 'number') return Number.isFinite(balance) ? balance : 0;
  if (!balance) return 0;

  const value =
    balance.spendable ??
    balance.available ??
    balance.settled ??
    balance.total ??
    balance.future ??
    0;

  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function getAssetDisplayBalance(balance: AssetBalanceLike, precision: number): number {
  return getAssetBaseUnitBalance(balance) / Math.pow(10, precision || 0);
}
