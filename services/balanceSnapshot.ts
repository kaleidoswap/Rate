/**
 * The last balances the dashboard showed, per wallet, so the next launch can show
 * them at once while the accounts reconnect. Balances only — never keys or
 * addresses — kept in AsyncStorage (not encrypted).
 *
 * Keyed by wallet id AND creation time, so a new wallet that reuses a deleted
 * wallet's id never sees the old wallet's numbers.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'rate.balanceSnapshot.v1.';

export interface SnapshotWallet {
  id?: number;
  created_at?: number;
}

export interface SnapshotProtocolBalance { confirmed: number; unconfirmed: number; total: number }

export interface SnapshotChannel {
  local_balance_sat: number;
  outbound_balance_msat: number;
  ready: boolean;
  is_usable: boolean;
}

export interface BalanceSnapshot {
  walletKey: string;
  savedAt: number;
  byProtocol: Record<string, SnapshotProtocolBalance>;
  /** Asset rows as the dashboard keeps them (ticker, precision, balance, protocol, icon). */
  assets: any[];
  channels: SnapshotChannel[];
  btcPriceUSD: number;
}

export function snapshotWalletKey(wallet: SnapshotWallet | null | undefined): string | null {
  if (wallet?.id == null) return null;
  return `${wallet.id}:${wallet.created_at ?? 0}`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates a stored snapshot for `walletKey`; anything else reads as "none". */
export function parseSnapshot(raw: string | null, walletKey: string): BalanceSnapshot | null {
  if (!raw) return null;
  let s: any;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || s.walletKey !== walletKey || !isNum(s.savedAt)) return null;
  const byProtocol: Record<string, SnapshotProtocolBalance> = {};
  for (const [k, b] of Object.entries((s.byProtocol ?? {}) as Record<string, any>)) {
    if (b && isNum(b.confirmed) && isNum(b.unconfirmed) && isNum(b.total)) {
      byProtocol[k] = { confirmed: b.confirmed, unconfirmed: b.unconfirmed, total: b.total };
    }
  }
  const assets = Array.isArray(s.assets)
    ? s.assets.filter((a: any) => a && typeof a.asset_id === 'string' && typeof a.ticker === 'string')
    : [];
  const channels = Array.isArray(s.channels)
    ? s.channels.filter((c: any) => c && isNum(c.local_balance_sat) && isNum(c.outbound_balance_msat))
    : [];
  return { walletKey, savedAt: s.savedAt, byProtocol, assets, channels, btcPriceUSD: isNum(s.btcPriceUSD) ? s.btcPriceUSD : 0 };
}

export async function loadBalanceSnapshot(wallet: SnapshotWallet | null | undefined): Promise<BalanceSnapshot | null> {
  const key = snapshotWalletKey(wallet);
  if (!key) return null;
  try {
    return parseSnapshot(await AsyncStorage.getItem(PREFIX + key), key);
  } catch {
    return null;
  }
}

export async function saveBalanceSnapshot(
  wallet: SnapshotWallet | null | undefined,
  data: Omit<BalanceSnapshot, 'walletKey' | 'savedAt'>,
): Promise<void> {
  const key = snapshotWalletKey(wallet);
  if (!key) return;
  const snapshot: BalanceSnapshot = {
    walletKey: key,
    savedAt: Date.now(),
    byProtocol: data.byProtocol,
    assets: data.assets,
    // Only what the bitcoin total needs from a channel.
    channels: data.channels.map((c) => ({
      local_balance_sat: c.local_balance_sat,
      outbound_balance_msat: c.outbound_balance_msat,
      ready: c.ready,
      is_usable: c.is_usable,
    })),
    btcPriceUSD: data.btcPriceUSD,
  };
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[balanceSnapshot] save failed:', e);
  }
}

export async function hasBalanceSnapshot(wallet: SnapshotWallet | null | undefined): Promise<boolean> {
  return (await loadBalanceSnapshot(wallet)) != null;
}

/** Forget every snapshot of a wallet id (on delete). */
export async function clearBalanceSnapshots(walletId: number): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(`${PREFIX}${walletId}:`));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch (e) {
    console.warn('[balanceSnapshot] clear failed:', e);
  }
}
