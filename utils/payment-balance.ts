interface Balance { confirmed: number; total: number }
interface Channel { ready?: boolean; is_usable?: boolean; local_balance_sat?: number; outbound_balance_msat?: number; next_outbound_htlc_limit_msat?: number }
const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
/** On-chain unconfirmed funds and other accounts cannot fund this route. */
export function routeSpendable(balance: Balance | undefined, account: string | undefined, method: string | undefined, channels: Channel[], lightningBalance = false): number {
  if (account === 'RGB' && method === 'lightning' && !lightningBalance) {
    return Math.floor(channels.filter(c => c.ready && c.is_usable).reduce((sum, c) => sum + Math.min(
      positive(c.local_balance_sat), positive(c.outbound_balance_msat) / 1000,
      c.next_outbound_htlc_limit_msat == null ? Infinity : positive(c.next_outbound_htlc_limit_msat) / 1000,
    ), 0));
  }
  return Math.floor(positive(balance?.confirmed));
}
