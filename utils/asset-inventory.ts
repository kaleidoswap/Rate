/**
 * The wallet's asset inventory: bitcoin plus every account's assets, one list
 * that Dashboard, Swap, Assets and Receive all read.
 *
 * Accounts' assets reach redux (`assets.rgbAssets`) through `assetRecordFromUnified`,
 * whoever fetches them (the dashboard's refresh or `syncAssets`), so every screen
 * sees the same balance for the same asset. Bitcoin is built here once, from the
 * dashboard's bitcoin figures (`wallet.btcBalance`). Pure apart from the selector.
 */
import { createSelector } from '@reduxjs/toolkit';
import { liteBucketOf } from '@kaleidorg/wallet-engine';
import { getAssetBaseUnitBalance, resolvePrecision, type AssetBalanceLike } from './assetAmount';
import { getAssetFamily } from './account-routing';
import { isUsdbTokenAddress, USDB_DECIMALS, USDB_NAME, USDB_TICKER } from './flashnet';
import type { BtcNetwork } from './wallet-balance-summary';

export type TokenProtocol = 'RGB' | 'SPARK' | 'ARKADE';
export type InventoryProtocol = 'BTC' | TokenProtocol;

/** An asset's balance breakdown in base units, as the accounts report it. */
export interface AssetBalanceDetail {
  settled: number;
  future: number;
  spendable: number;
  offchain_outbound: number;
  offchain_inbound: number;
}

/** What redux keeps per asset (`assets.rgbAssets`). */
export interface InventoryRecord {
  wallet_id?: number;
  asset_id: string;
  ticker: string;
  name: string;
  precision: number;
  issued_supply?: number;
  protocol?: string | null;
  icon?: string;
  /** Base units the rows show (spendable). Older rows and snapshots may hold the breakdown here. */
  balance: AssetBalanceLike;
  balanceDetail?: Partial<AssetBalanceDetail>;
  last_updated?: number;
}

export interface InventoryAsset {
  asset_id: string;
  ticker: string;
  name: string;
  /** Real decimals: 8 for bitcoin (amounts in sats), the token's own otherwise. */
  precision: number;
  protocol: InventoryProtocol;
  isNativeBtc: boolean;
  /** Base units the wallet shows: available sats for bitcoin, spendable units for tokens. */
  balance: number;
  /** Tokens: the full breakdown (in channels, incoming), when known. */
  balanceDetail?: Partial<AssetBalanceDetail>;
  /** Bitcoin: sats per network, as the balance card's breakdown shows them. */
  networks?: Partial<Record<BtcNetwork, number>>;
  icon?: string;
  issued_supply?: number;
}

export interface InventoryBtcInput {
  /** Available bitcoin in sats (the dashboard's summary.available). */
  available: number;
  networks?: Partial<Record<BtcNetwork, number>>;
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** An account's asset (`adapter.listAssets()`) as redux keeps it; null for bitcoin. */
export function assetRecordFromUnified(a: any, protocol: TokenProtocol, walletId = 1): InventoryRecord | null {
  if (!a?.id || a.id === 'BTC') return null;
  // Spark reports USDB under its raw token name and precision.
  const isUsdb = isUsdbTokenAddress(a.id);
  const b = a.balance ?? {};
  const balanceDetail: AssetBalanceDetail = {
    settled: num(b.settled ?? b.total),
    future: num(b.pending),
    // `available` already folds in on-chain spendable and in-channel outbound
    // (NwcRgbAdapter.mapAssetBalance), so it is the real holding even when an
    // asset sits only in a channel.
    spendable: num(b.available),
    offchain_outbound: num(b.offchain_outbound ?? b.locked),
    offchain_inbound: num(b.offchain_inbound),
  };
  return {
    wallet_id: walletId,
    asset_id: a.id,
    ticker: isUsdb ? USDB_TICKER : a.ticker,
    name: isUsdb ? USDB_NAME : a.name,
    precision: isUsdb ? USDB_DECIMALS : resolvePrecision(a.precision, 0),
    issued_supply: num(a.metadata?.issued_supply),
    protocol,
    icon: a.icon,
    balance: getAssetBaseUnitBalance(balanceDetail),
    balanceDetail,
    last_updated: Date.now(),
  };
}

/** One account's fresh assets replace what it listed before; the others are kept. */
export function replaceProtocolAssets<T extends { protocol?: string | null; asset_id: string }>(
  current: readonly T[], protocol: TokenProtocol, fresh: readonly T[],
): T[] {
  const ids = new Set(fresh.map((a) => a.asset_id));
  // A row without a protocol (an older record) belongs to whichever account now lists it.
  return [...current.filter((a) => a.protocol ? a.protocol !== protocol : !ids.has(a.asset_id)), ...fresh];
}

/**
 * Live records, plus the last known ones of accounts that haven't listed their
 * assets yet (the dashboard's fast start).
 */
export function withSnapshotFallback(
  live: readonly InventoryRecord[], snapshot: readonly InventoryRecord[],
): InventoryRecord[] {
  const liveProtocols = new Set(live.map(tokenProtocol));
  return [...snapshot.filter((r) => !liveProtocols.has(tokenProtocol(r))), ...live];
}

function tokenProtocol(r: InventoryRecord): TokenProtocol {
  const p = String(r.protocol ?? '').toUpperCase();
  if (p === 'SPARK' || p === 'ARKADE' || p === 'RGB') return p;
  if (p === 'RGB_LN' || p === 'RGB_L1') return 'RGB';
  const family = getAssetFamily(r.asset_id, r.ticker);
  return family === 'BTC' ? 'RGB' : family;
}

function tokenEntry(r: InventoryRecord): InventoryAsset {
  const detail = r.balanceDetail ?? (r.balance && typeof r.balance === 'object' ? r.balance as Partial<AssetBalanceDetail> : undefined);
  return {
    asset_id: r.asset_id,
    ticker: r.ticker,
    name: r.name || r.ticker,
    precision: resolvePrecision(r.precision, 0),
    protocol: tokenProtocol(r),
    isNativeBtc: false,
    balance: getAssetBaseUnitBalance(r.balance),
    ...(detail ? { balanceDetail: detail } : {}),
    ...(r.icon ? { icon: r.icon } : {}),
    ...(r.issued_supply != null ? { issued_supply: r.issued_supply } : {}),
  };
}

export function btcInventoryEntry(btc: InventoryBtcInput | null | undefined): InventoryAsset {
  return {
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    precision: 8,
    protocol: 'BTC',
    isNativeBtc: true,
    balance: Math.max(0, num(btc?.available)),
    networks: btc?.networks ?? {},
  };
}

/**
 * Bitcoin first, then each account's assets in the order they were listed.
 * An asset never appears twice for the same account, and a record that claims
 * to be bitcoin is ignored (bitcoin comes only from the bitcoin balances).
 */
export function buildAssetInventory(args: {
  btc: InventoryBtcInput | null | undefined;
  assets: readonly InventoryRecord[] | null | undefined;
}): InventoryAsset[] {
  const out: InventoryAsset[] = [btcInventoryEntry(args.btc)];
  const seen = new Set<string>();
  for (const record of args.assets ?? []) {
    if (!record?.asset_id || record.asset_id === 'BTC') continue;
    const entry = tokenEntry(record);
    const key = `${entry.protocol}:${entry.asset_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export const inventoryTokens = (inventory: readonly InventoryAsset[]): InventoryAsset[] =>
  inventory.filter((a) => !a.isNativeBtc);

export const inventoryBtc = (inventory: readonly InventoryAsset[]): InventoryAsset =>
  inventory.find((a) => a.isNativeBtc) ?? btcInventoryEntry(null);

/** Assets Lite folds into its single "US Dollar" line (by adapter id, never by ticker). */
export function liteUsdAssetIds(assets: readonly { asset_id: string }[]): Set<string> {
  return new Set(assets
    .filter((a) => liteBucketOf({ id: a.asset_id } as any) === 'USD')
    .map((a) => a.asset_id));
}

/** The figures redux holds for bitcoin, as the inventory reads them. */
export function btcInputFromWallet(btcBalance: {
  vanilla?: { spendable?: number }; colored?: { spendable?: number };
  summary?: { available: number }; networks?: Partial<Record<BtcNetwork, number>>;
} | null | undefined): InventoryBtcInput | null {
  if (!btcBalance) return null;
  return {
    available: btcBalance.summary?.available ?? (num(btcBalance.vanilla?.spendable) + num(btcBalance.colored?.spendable)),
    networks: btcBalance.networks,
  };
}

interface InventoryState {
  wallet: { btcBalance: Parameters<typeof btcInputFromWallet>[0] };
  assets: { rgbAssets: readonly InventoryRecord[] };
}

export const selectAssetInventory = createSelector(
  [(s: InventoryState) => s.wallet.btcBalance, (s: InventoryState) => s.assets.rgbAssets],
  (btcBalance, rgbAssets) => buildAssetInventory({ btc: btcInputFromWallet(btcBalance), assets: rgbAssets }),
);
