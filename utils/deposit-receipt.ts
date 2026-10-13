/** Never substitute a requested amount for the amount actually detected. */
export function depositAmountLabel(amount: number | undefined, assetId: string | undefined, assets: { asset_id: string; ticker: string; precision?: number }[]): string | undefined {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return undefined;
  if (assetId === 'BTC') return `${amount.toLocaleString()} sats`;
  const asset = assets.find(a => a.asset_id === assetId);
  if (!asset || asset.precision == null || asset.precision < 0 || asset.precision > 18) return undefined;
  return `${(amount / 10 ** asset.precision).toLocaleString(undefined, { maximumFractionDigits: asset.precision })} ${asset.ticker}`;
}
