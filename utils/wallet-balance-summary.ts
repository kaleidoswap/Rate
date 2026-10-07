interface BitcoinBalance { confirmed: number; unconfirmed: number; total: number }
interface ChannelBalance {
  local_balance_sat: number;
  outbound_balance_msat: number;
  ready: boolean;
  is_usable: boolean;
}
const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * The wallet's real (mainnet) bitcoin, and separately what sits on test networks.
 * Test sats have no value, so they never join the total or its fiat figure.
 * NWC already includes Lightning; HTTP RLN exposes it separately in channels.
 */
export function summarizeBitcoinBalances(
  balances: Record<string, BitcoinBalance>,
  channels: ChannelBalance[],
  rgbBalanceIsLightning: boolean,
  /** Accounts known to be on a test network (signet, mutinynet, testnet, regtest). */
  testProtocols: ReadonlySet<string> = new Set(),
) {
  let total = 0;
  let available = 0;
  let test = 0;
  for (const [protocol, balance] of Object.entries(balances)) {
    const held = nonNegative(balance.confirmed) + nonNegative(balance.unconfirmed);
    if (testProtocols.has(protocol)) { test += held; continue; }
    total += held;
    available += nonNegative(protocol === 'RGB' ? balance.total : balance.confirmed);
  }
  if (!rgbBalanceIsLightning) {
    for (const channel of channels) {
      if (testProtocols.has('RGB')) { test += nonNegative(channel.local_balance_sat); continue; }
      total += nonNegative(channel.local_balance_sat);
      if (channel.ready && channel.is_usable) {
        available += Math.min(nonNegative(channel.local_balance_sat), nonNegative(channel.outbound_balance_msat) / 1000);
      }
    }
  }
  available = Math.min(total, available);
  return { total, available, unavailable: Math.max(0, total - available), test };
}

export interface BtcBalanceState {
  vanilla: { settled: number; future: number; spendable: number };
  colored: { settled: number; future: number; spendable: number };
  byProtocol?: Record<string, BitcoinBalance>;
}

/** The dashboard's balance shape from per-account balances. */
export function btcBalanceFromProtocols(byProtocol: Record<string, BitcoinBalance>): BtcBalanceState & { byProtocol: Record<string, BitcoinBalance> } {
  let confirmed = 0;
  let unconfirmed = 0;
  for (const b of Object.values(byProtocol)) {
    confirmed += b.confirmed;
    unconfirmed += b.unconfirmed;
  }
  return {
    vanilla: { settled: confirmed, future: confirmed + unconfirmed, spendable: confirmed },
    colored: { settled: 0, future: 0, spendable: 0 },
    byProtocol,
  };
}

/** One account's fresh balance replaces its entry; the others keep what they showed. */
export function withProtocolBalance(prev: BtcBalanceState | null | undefined, protocol: string, balance: BitcoinBalance) {
  return btcBalanceFromProtocols({ ...(prev?.byProtocol ?? {}), [protocol]: balance });
}

export type BtcNetwork = 'onchain' | 'lightning' | 'spark' | 'arkade' | 'bark';

/**
 * Bitcoin per network, as the balance card's breakdown shows it: the RGB node's
 * wallet is on-chain (its channels are Lightning), unless it is an NWC wallet,
 * whose whole balance is Lightning.
 */
export function bitcoinByNetwork(
  balances: Record<string, BitcoinBalance>,
  channels: ChannelBalance[],
  rgbBalanceIsLightning: boolean,
): Partial<Record<BtcNetwork, number>> {
  const out: Partial<Record<BtcNetwork, number>> = {};
  const rgb = balances.RGB;
  if (rgb) {
    if (rgbBalanceIsLightning) out.lightning = nonNegative(rgb.total);
    else {
      out.onchain = nonNegative(rgb.confirmed);
      out.lightning = channels.reduce((sum, c) => sum + nonNegative(c.local_balance_sat), 0);
    }
  }
  if (balances.SPARK) out.spark = nonNegative(balances.SPARK.total);
  if (balances.ARKADE) out.arkade = nonNegative(balances.ARKADE.total);
  if (balances.BARK) out.bark = nonNegative(balances.BARK.total);
  return out;
}
