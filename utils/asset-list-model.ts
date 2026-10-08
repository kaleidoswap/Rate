/**
 * The "all assets" list: one row per asset, merged across the networks it lives
 * on (the extension's buildDashboardAssetItems), with network filters and search.
 *
 * Bitcoin is one row whose "All" figure is the dashboard's BTC row (available
 * bitcoin); a network filter shows that network's share instead. Tokens with the
 * same ticker on several networks (e.g. USDT on RGB and Spark) are one row whose
 * amount is the sum. Pure: the screen passes in redux data.
 */
import { getAssetBaseUnitBalance, type AssetBalanceLike } from './assetAmount';
import { tokenUsdPrice } from './portfolio';
import type { BtcNetwork } from './wallet-balance-summary';

export type AssetNetwork = BtcNetwork | 'rgb';
export type AssetFilter = 'all' | AssetNetwork;

/** Filter order, and the networks each chip stands for. */
export const ASSET_FILTERS: ReadonlyArray<{ key: AssetFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'onchain', label: 'Bitcoin' },
  { key: 'lightning', label: 'Lightning' },
  { key: 'spark', label: 'Spark' },
  { key: 'arkade', label: 'Arkade' },
  { key: 'bark', label: 'Bark' },
  { key: 'rgb', label: 'RGB' },
];

export interface AssetListToken {
  asset_id: string;
  ticker: string;
  name: string;
  precision?: number | null;
  balance: AssetBalanceLike;
  protocol?: string | null;
  icon?: string;
  /** The full balance breakdown, for the detail screen. */
  balanceDetail?: unknown;
}

export interface AssetHolding {
  network: AssetNetwork;
  /** Whole-token amount on this network. */
  amount: number;
  /** The record behind it (for the detail screen); undefined for bitcoin. */
  token?: AssetListToken;
}

export interface AssetListItem {
  key: string;
  ticker: string;
  name: string;
  /** Decimals to show: sats → 0, BTC → 8, tokens → their largest precision. */
  precision: number;
  /** Whole-token amount ("All" view). For bitcoin in sats unless shown in BTC. */
  amount: number;
  networks: AssetNetwork[];
  holdings: AssetHolding[];
  isBtc: boolean;
  /** Dollar value of `amount`, when the asset has a price. */
  usdValue?: number;
  /** Dollars per unit of `amount` (per sat for bitcoin), when priced. */
  unitUsd?: number;
  icon?: string;
}

export interface BuildAssetListArgs {
  /** Bitcoin per network in sats (wallet.btcBalance.networks). */
  btcNetworks?: Partial<Record<BtcNetwork, number>>;
  /** The dashboard's BTC row figure in sats (summary.available). */
  btcAvailable: number;
  /** Show bitcoin at all (false before any balance is known and nothing is held). */
  showBtc: boolean;
  assets: readonly AssetListToken[];
  btcPriceUSD: number;
  /** Assets the dashboard folds into its "USD" line (Lite). */
  liteUsdAssetIds?: ReadonlySet<string>;
}

const BTC_NETWORK_ORDER: BtcNetwork[] = ['onchain', 'lightning', 'spark', 'arkade', 'bark'];
export const LITE_USD_KEY = 'lite-usd';

export function networkOfProtocol(protocol?: string | null): AssetNetwork {
  switch (String(protocol ?? '').toUpperCase()) {
    case 'SPARK': return 'spark';
    case 'ARKADE': return 'arkade';
    case 'BARK': return 'bark';
    default: return 'rgb';
  }
}

const wholeAmount = (t: AssetListToken) => getAssetBaseUnitBalance(t.balance) / Math.pow(10, t.precision || 0);

export function buildAssetListItems(args: BuildAssetListArgs): AssetListItem[] {
  const items: AssetListItem[] = [];
  const btcNetworks = args.btcNetworks ?? {};

  if (args.showBtc) {
    const held = BTC_NETWORK_ORDER.filter((n) => (btcNetworks[n] ?? 0) > 0);
    const present = BTC_NETWORK_ORDER.filter((n) => btcNetworks[n] !== undefined);
    items.push({
      key: 'BTC',
      ticker: 'BTC',
      name: 'Bitcoin',
      precision: 0,
      amount: Math.max(0, args.btcAvailable),
      networks: held.length ? held : present,
      holdings: present.map((network) => ({ network, amount: btcNetworks[network] ?? 0 })),
      isBtc: true,
      ...priced(Math.max(0, args.btcAvailable), args.btcPriceUSD > 0 ? args.btcPriceUSD / 1e8 : undefined),
    });
  }

  // Lite's single USD line, as on the dashboard.
  const liteUsd = args.assets.filter((a) => args.liteUsdAssetIds?.has(a.asset_id));
  const rest = args.assets.filter((a) => a.asset_id !== 'BTC' && !args.liteUsdAssetIds?.has(a.asset_id));
  if (liteUsd.length) {
    const holdings = liteUsd.map((token) => ({ network: networkOfProtocol(token.protocol), amount: wholeAmount(token), token }));
    const amount = holdings.reduce((s, h) => s + h.amount, 0);
    if (amount > 0) {
      items.push({
        key: LITE_USD_KEY, ticker: 'USD', name: 'US Dollar', precision: 2, amount,
        networks: unique(holdings.map((h) => h.network)), holdings, isBtc: false, ...priced(amount, 1),
      });
    }
  }

  const byTicker = new Map<string, AssetListItem>();
  for (const token of rest) {
    const tickerKey = String(token.ticker || token.asset_id).trim().toUpperCase();
    const holding: AssetHolding = { network: networkOfProtocol(token.protocol), amount: wholeAmount(token), token };
    const existing = byTicker.get(tickerKey);
    if (!existing) {
      const item: AssetListItem = {
        key: `asset:${tickerKey}`,
        ticker: token.ticker,
        name: token.name || token.ticker,
        precision: token.precision || 0,
        amount: holding.amount,
        networks: [holding.network],
        holdings: [holding],
        isBtc: false,
        icon: token.icon,
      };
      byTicker.set(tickerKey, item);
      items.push(item);
      continue;
    }
    existing.holdings.push(holding);
    existing.amount += holding.amount;
    existing.precision = Math.max(existing.precision, token.precision || 0);
    if (!existing.networks.includes(holding.network)) existing.networks.push(holding.network);
    existing.icon = existing.icon ?? token.icon;
  }
  for (const item of byTicker.values()) {
    // The name follows the largest holding.
    const top = dominantHolding(item)?.token;
    if (top?.name) item.name = top.name;
    Object.assign(item, priced(item.amount, tokenUsdPrice(item.ticker) ?? undefined));
  }
  return items;
}

function priced(amount: number, unitUsd: number | undefined): Pick<AssetListItem, 'usdValue' | 'unitUsd'> {
  return unitUsd === undefined ? {} : { unitUsd, usdValue: amount * unitUsd };
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** The holding a tap opens: the largest one. */
export function dominantHolding(item: AssetListItem): AssetHolding | undefined {
  return item.holdings.reduce<AssetHolding | undefined>((best, h) => (!best || h.amount > best.amount ? h : best), undefined);
}

/** Filters that would show something, in display order ("All" always). */
export function availableAssetFilters(items: readonly AssetListItem[]): AssetFilter[] {
  const present = new Set<AssetNetwork>();
  for (const item of items) for (const h of item.holdings) present.add(h.network);
  return ASSET_FILTERS.map((f) => f.key).filter((k) => k === 'all' || present.has(k as AssetNetwork));
}

/**
 * Rows for a filter and search text. Under a network filter each row shows just
 * that network's amount (and value); rows with nothing there are dropped.
 */
export function filterAssetItems(items: readonly AssetListItem[], filter: AssetFilter, query = ''): AssetListItem[] {
  const q = query.trim().toLowerCase();
  const matches = (item: AssetListItem) =>
    !q || item.ticker.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
    || item.holdings.some((h) => h.token?.asset_id.toLowerCase() === q);
  const out: AssetListItem[] = [];
  for (const item of items) {
    if (!matches(item)) continue;
    if (filter === 'all') { out.push(item); continue; }
    const holdings = item.holdings.filter((h) => h.network === filter);
    if (!holdings.length) continue;
    const amount = holdings.reduce((s, h) => s + h.amount, 0);
    out.push({
      ...item,
      amount,
      holdings,
      networks: [filter],
      usdValue: item.unitUsd !== undefined ? amount * item.unitUsd : undefined,
    });
  }
  return out;
}

/** Total dollar value of what a list shows. */
export function assetListUsdTotal(items: readonly AssetListItem[]): number {
  return items.reduce((s, i) => s + (i.usdValue && i.usdValue > 0 ? i.usdValue : 0), 0);
}

const NETWORK_LABELS: Record<AssetNetwork, string> = {
  onchain: 'Bitcoin', lightning: 'Lightning', spark: 'Spark', arkade: 'Arkade', bark: 'Bark', rgb: 'RGB',
};

export function networkLabel(network: AssetNetwork): string {
  return NETWORK_LABELS[network] ?? network;
}

/** A whole-token amount with thousands separators and at most `precision` decimals: 1234.5 → "1,234.5". */
export function formatTokenAmount(amount: number, precision: number): string {
  if (!Number.isFinite(amount)) return '0';
  let fixed = amount.toFixed(Math.max(0, Math.min(precision, 20)));
  if (fixed.includes('.')) fixed = fixed.replace(/\.?0+$/, '');
  const [int, frac] = fixed.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? `.${frac}` : '');
}
