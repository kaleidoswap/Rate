interface BitcoinBalance { confirmed: number; unconfirmed: number; total: number }
interface ChannelBalance {
  local_balance_sat: number;
  outbound_balance_msat: number;
  ready: boolean;
  is_usable: boolean;
}
const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** NWC already includes Lightning; HTTP RLN exposes it separately in channels. */
export function summarizeBitcoinBalances(
  balances: Record<string, BitcoinBalance>,
  channels: ChannelBalance[],
  rgbBalanceIsLightning: boolean,
) {
  let total = 0;
  let available = 0;
  for (const [protocol, balance] of Object.entries(balances)) {
    total += nonNegative(balance.confirmed) + nonNegative(balance.unconfirmed);
    available += nonNegative(protocol === 'RGB' ? balance.total : balance.confirmed);
  }
  if (!rgbBalanceIsLightning) {
    for (const channel of channels) {
      total += nonNegative(channel.local_balance_sat);
      if (channel.ready && channel.is_usable) {
        available += Math.min(nonNegative(channel.local_balance_sat), nonNegative(channel.outbound_balance_msat) / 1000);
      }
    }
  }
  available = Math.min(total, available);
  return { total, available, unavailable: Math.max(0, total - available) };
}
