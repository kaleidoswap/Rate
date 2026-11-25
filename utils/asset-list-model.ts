/**
 * One row per contract and network, with network filters and search.
 *
 * Bitcoin is one row whose "All" figure is the dashboard's BTC row (available
 * bitcoin); a network filter shows that network's share instead. The verified
 * Lite USD balance is folded explicitly. Tickers are display labels.
 */
import { getAssetBaseUnitBalance, type AssetBalanceLike } from './assetAmount';
import { tokenUsdPrice } from './portfolio';
import { getAssetFamily } from './account-routing';
import { shortContractId } from './rgb-receive';
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
  /** Bitcoin's fiat value on this network, excluding test funds. */
  btcUsdValue?: number;
  chain?: string;
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
  btcNetwork?: BtcNetwork;
  assetIdLabel?: string;
  /** Dollar value of `amount`, when the asset has a price. */
  usdValue?: number;
  /** Dollars per unit of `amount` (per sat for bitcoin), when priced. */
  unitUsd?: number;
  icon?: string;
}

export interface BuildAssetListArgs {
  /** Bitcoin per network in sats (wallet.btcBalance.networks). */
  btcNetworks?: Partial<Record<BtcNetwork, number>>;
  /** Mainnet portion of each Bitcoin network balance when test funds are present. */
  btcMainnetNetworks?: Partial<Record<BtcNetwork, number>>;
  btcNetworkChains?: Partial<Record<BtcNetwork, string>>;
  /** The dashboard's BTC row figure in sats (summary.available). */
  btcAvailable: number;
  /** Show bitcoin at all (false before any balance is known and nothing is held). */
  showBtc: boolean;
  assets: readonly AssetListToken[];
  btcPriceUSD: number;
  /** Assets the dashboard folds into its "USD" line (Lite). */
  liteUsdAssetIds?: ReadonlySet<string>;
  testProtocols?: ReadonlySet<string>;
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

function tokenItem(holding: AssetHolding & { token: AssetListToken }, unitUsd?: number): AssetListItem {
  const { token, network, amount } = holding;
  return {
    key: `asset:${network}:${token.asset_id}`,
    ticker: token.ticker,
    name: token.name || token.ticker,
    precision: token.precision || 0,
    amount,
    networks: [network],
    holdings: [holding],
    isBtc: false,
    icon: token.icon,
    ...priced(amount, unitUsd),
  };
}

export function buildAssetListItems(args: BuildAssetListArgs): AssetListItem[] {
  const items: AssetListItem[] = [];
  const btcNetworks = args.btcNetworks ?? {};
  const btcUnitUsd = args.btcPriceUSD > 0 ? args.btcPriceUSD / 1e8 : undefined;

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
      holdings: present.map((network) => {
        const amount = btcNetworks[network] ?? 0;
        const mainnetSats = args.btcMainnetNetworks ? args.btcMainnetNetworks[network] ?? 0
          : args.btcNetworkChains?.[network] ? 0 : amount;
        return { network, amount, chain: args.btcNetworkChains?.[network],
          btcUsdValue: btcUnitUsd === undefined ? undefined : mainnetSats * btcUnitUsd };
      }),
      isBtc: true,
      ...priced(Math.max(0, args.btcAvailable), btcUnitUsd),
    });
  }

  // Lite's single USD line, as on the dashboard.
  const rest: AssetListItem[] = [];
  const holdings: AssetHolding[] = [];
  const tickerCounts = new Map<string, number>();
  const seen = new Set<string>();
  for (const token of args.assets) {
    if (token.asset_id === 'BTC') continue;
    const holding = { network: networkOfProtocol(token.protocol), amount: wholeAmount(token), token };
    const price = tokenUsdPrice(token, args.testProtocols);
    const item = tokenItem(holding, price);
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    if (price === 1 && args.liteUsdAssetIds?.has(token.asset_id)) {
      holdings.push(holding);
      continue;
    }
    const ticker = item.ticker.trim().toUpperCase();
    tickerCounts.set(ticker, (tickerCounts.get(ticker) ?? 0) + 1);
    rest.push(item);
  }
  if (holdings.length) {
    const amount = holdings.reduce((s, h) => s + h.amount, 0);
    if (amount > 0) {
      items.push({
        key: LITE_USD_KEY, ticker: 'USD', name: 'US Dollar', precision: 2, amount,
        networks: unique(holdings.map((h) => h.network)), holdings, isBtc: false, ...priced(amount, 1),
      });
    }
  }

  for (const item of rest) {
    if ((tickerCounts.get(item.ticker.trim().toUpperCase()) ?? 0) > 1) {
      item.assetIdLabel = shortContractId(item.holdings[0].token!.asset_id);
    }
    items.push(item);
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

/** Preserve the selected network and full balance when opening an asset. */
export function assetDetailForItem(item: AssetListItem, bitcoinUnit: 'BTC' | 'sats') {
  if (item.isBtc) {
    return {
      asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false, protocol: 'BTC' as const,
      precision: bitcoinUnit === 'BTC' ? 8 : 0, unit: bitcoinUnit,
      balance: { spendable: item.amount }, fiatValue: item.usdValue,
      btcNetwork: item.btcNetwork,
      btcUnitUsd: item.unitUsd,
      locations: item.holdings.map(h => ({ label: btcNetworkLabel(h.network, h.chain), amount: h.amount, unit: 'sats' })),
    };
  }
  const holding = dominantHolding(item);
  if (!holding?.token) return undefined;
  const token = holding.token;
  const { protocol } = token;
  const family = protocol === 'RGB' || protocol === 'SPARK' || protocol === 'ARKADE'
    ? protocol
    : getAssetFamily(token.asset_id, token.ticker);
  return {
    ...token,
    balance: token.balanceDetail ?? token.balance,
    isRGB: family === 'RGB',
    protocol: family,
    locations: item.holdings.map(h => ({ label: networkLabel(h.network), amount: h.amount, unit: item.ticker })),
    fiatValue: item.unitUsd === undefined ? undefined : holding.amount * item.unitUsd,
    unitUsd: item.unitUsd,
  };
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
  const typedId = query.trim();
  const q = typedId.toLowerCase();
  const matchesId = (h: AssetHolding): h is AssetHolding & { token: AssetListToken } => {
    const id = h.token?.asset_id;
    return !!id && (id.startsWith('rgb:') ? id === typedId : id.toLowerCase() === q);
  };
  const exactSearch = !!q && items.some((item) => item.holdings.some(matchesId));
  const out: AssetListItem[] = [];
  for (const item of items) {
    if (exactSearch) {
      const matching = item.holdings.filter(matchesId).filter(h => filter === 'all' || h.network === filter);
      if (matching.length && item.key === LITE_USD_KEY) out.push(...matching.map(h => tokenItem(h, item.unitUsd)));
      else if (matching.length) out.push(item);
      continue;
    }
    if (q && !item.ticker.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) continue;
    if (filter === 'all') { out.push(item); continue; }
    const holdings = item.holdings.filter((h) => h.network === filter);
    if (!holdings.length) continue;
    const amount = holdings.reduce((s, h) => s + h.amount, 0);
    out.push({
      ...item,
      amount,
      holdings,
      networks: [filter],
      btcNetwork: item.isBtc && filter !== 'rgb' ? filter : undefined,
      usdValue: item.isBtc
        ? holdings.reduce((sum, holding) => sum + (holding.btcUsdValue ?? 0), 0) || undefined
        : item.unitUsd !== undefined ? amount * item.unitUsd : undefined,
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

export function btcNetworkLabel(network: AssetNetwork, testChain?: string): string {
  const label = network === 'onchain' ? 'Bitcoin on-chain' : networkLabel(network);
  return testChain ? `${label} · ${testChain} (test)` : label;
}

/** A whole-token amount with thousands separators and at most `precision` decimals: 1234.5 → "1,234.5". */
export function formatTokenAmount(amount: number, precision: number): string {
  if (!Number.isFinite(amount)) return '0';
  let fixed = amount.toFixed(Math.max(0, Math.min(precision, 20)));
  if (fixed.includes('.')) fixed = fixed.replace(/\.?0+$/, '');
  const [int, frac] = fixed.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? `.${frac}` : '');
}
