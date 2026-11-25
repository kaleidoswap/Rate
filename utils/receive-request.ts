/** Convert a requested bitcoin amount to protocol satoshis exactly once. */
export function receiveAmountSats(amount: string, unit: 'BTC' | 'sats'): number {
  const parsed = Number(amount.replace(/,/g, ''));
  if (unit === 'sats' && !Number.isSafeInteger(parsed)) return 0;
  const sats = Math.round(parsed * (unit === 'BTC' ? 1e8 : 1));
  return Number.isSafeInteger(sats) && sats > 0 ? sats : 0;
}

/** A universal Bitcoin request can only carry Lightning when both rails request the same amount. */
export function needsSeparateLightningInvoice(receive: { amountSats: number; payAmountSats: number } | null): boolean {
  return !!receive && receive.amountSats !== receive.payAmountSats;
}
