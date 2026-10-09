// Proactive insights: small rule-based cards on the Dashboard, no model needed.
// Each has one action, can be dismissed, and stays dismissed per wallet for its
// cooldown. At most a couple show at once.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityItem } from './ActivityService';

export type InsightMood = 'happy' | 'concerned' | 'idle';

export type InsightAction =
  | { kind: 'navigate'; screen: string; params?: Record<string, unknown> }
  | { kind: 'backup-rgb' }
  | { kind: 'open-activity' };

export interface Insight {
  /** Stable per occurrence; dismissals are stored under it. */
  key: string;
  rule: InsightRule;
  title: string;
  message: string;
  mood: InsightMood;
  tone: 'info' | 'warning' | 'success';
  action: { label: string; do: InsightAction };
  /** Lower shows first. */
  priority: number;
  /** How long a dismissal lasts. */
  cooldownMs: number;
}

export type InsightRule =
  | 'rgb-backup-failed' | 'rgb-backup-missing' | 'channel-state-backup'
  | 'needs-attention' | 'inbound-low' | 'large-incoming' | 'low-fees';

export interface InsightChannel {
  assetTicker?: string;
  /** Units the wallet holds in the channel and the units it can still receive. */
  localUnits: number;
  remoteUnits: number;
  usable: boolean;
}

export interface InsightInput {
  now: number;
  advanced: boolean;
  /** Mainnet fee rates (sat/vB), null when unknown or not on mainnet. */
  feeRates?: { fastestFee: number; halfHourFee: number; hourFee: number } | null;
  onchainSat: number;
  rgbOnDevice: boolean;
  rgbAssetsWithBalance: number;
  rgbBackup?: { state: 'idle' | 'backing-up' | 'done' | 'failed'; lastBackupAt?: number } | null;
  channels: InsightChannel[];
  activity: ActivityItem[];
  btcPriceUsd?: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const LOW_FEE_SAT_VB = 3;
export const LARGE_INCOMING_SAT = 1_000_000;
export const LARGE_INCOMING_USD = 500;
export const INBOUND_LOW_SHARE = 0.1;
export const STUCK_SWAP_MS = 15 * 60_000;
export const MAX_VISIBLE = 2;

const sats = (n: number) => `${n.toLocaleString('en-US')} sats`;

export function computeInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const { now } = input;

  if (input.rgbBackup?.state === 'failed') {
    out.push({
      key: 'rgb-backup-failed', rule: 'rgb-backup-failed', priority: 0, cooldownMs: DAY,
      title: 'RGB backup didn’t finish',
      message: 'The last cloud backup of your RGB assets failed. Without it, your recovery phrase alone can’t bring them back.',
      mood: 'concerned', tone: 'warning', action: { label: 'Back up now', do: { kind: 'backup-rgb' } },
    });
  } else if (input.rgbOnDevice && input.rgbAssetsWithBalance > 0 && input.rgbBackup?.state === 'idle' && !input.rgbBackup.lastBackupAt) {
    out.push({
      key: 'rgb-backup-missing', rule: 'rgb-backup-missing', priority: 1, cooldownMs: 3 * DAY,
      title: 'Back up your RGB assets',
      message: 'Your RGB assets aren’t in a cloud backup yet. Your recovery phrase alone can’t restore them.',
      mood: 'concerned', tone: 'warning', action: { label: 'Back up now', do: { kind: 'backup-rgb' } },
    });
  }

  if (input.advanced && !input.rgbOnDevice && input.channels.some((c) => c.localUnits > 0)) {
    out.push({
      key: 'channel-state-backup', rule: 'channel-state-backup', priority: 6, cooldownMs: 30 * DAY,
      title: 'Your node holds channel funds',
      message: 'Lightning channels on your RGB node can’t be restored from the recovery phrase alone. Make sure the node’s own backup is set up.',
      mood: 'concerned', tone: 'info', action: { label: 'Open node', do: { kind: 'navigate', screen: 'RgbNode' } },
    });
  }

  const attention = input.activity.find((i) =>
    i.status !== 'failed' && i.status !== 'confirmed' &&
    (i.status === 'unknown' || (i.type === 'swap' && (i.timestamp ?? now) <= now - STUCK_SWAP_MS)));
  if (attention) {
    const swap = attention.type === 'swap';
    out.push({
      key: `needs-attention:${attention.id}`, rule: 'needs-attention', priority: 2, cooldownMs: DAY,
      title: swap ? 'A swap is still pending' : 'A payment isn’t confirmed yet',
      message: swap
        ? 'One of your swaps hasn’t finished. It completes on both sides or not at all; check it before starting another.'
        : 'The provider hasn’t confirmed one of your payments. Check its status before paying again.',
      mood: 'concerned', tone: 'warning', action: { label: 'Check it', do: { kind: 'open-activity' } },
    });
  }

  for (const c of input.channels) {
    const total = c.localUnits + c.remoteUnits;
    if (!c.usable || !c.assetTicker || total <= 0 || c.remoteUnits / total >= INBOUND_LOW_SHARE) continue;
    out.push({
      key: `inbound-low:${c.assetTicker}`, rule: 'inbound-low', priority: 4, cooldownMs: 7 * DAY,
      title: `Little room to receive ${c.assetTicker}`,
      message: `Your ${c.assetTicker} channel can take only ${c.remoteUnits.toLocaleString('en-US')} ${c.assetTicker} more over Lightning. Add a channel to receive more.`,
      mood: 'concerned', tone: 'info', action: { label: 'Add channel', do: { kind: 'navigate', screen: 'LSP' } },
    });
    break;
  }

  const big = input.activity.find((i) => {
    if (i.type !== 'receive' || i.status !== 'confirmed' || i.rawSats == null || (i.timestamp ?? 0) < now - DAY) return false;
    const usd = input.btcPriceUsd ? (i.rawSats / 1e8) * input.btcPriceUsd : 0;
    return i.rawSats >= LARGE_INCOMING_SAT || usd >= LARGE_INCOMING_USD;
  });
  if (big) {
    out.push({
      key: `large-incoming:${big.id}`, rule: 'large-incoming', priority: 5, cooldownMs: 365 * DAY,
      title: 'Payment received',
      message: `${sats(big.rawSats!)} arrived${big.layer === 'L1' ? ' on-chain' : ''}. It’s confirmed and in your balance.`,
      mood: 'happy', tone: 'success', action: { label: 'See it', do: { kind: 'open-activity' } },
    });
  }

  const f = input.feeRates;
  if (f && input.onchainSat > 0 && f.halfHourFee > 0 && f.halfHourFee <= LOW_FEE_SAT_VB) {
    out.push({
      key: 'low-fees', rule: 'low-fees', priority: 7, cooldownMs: 3 * DAY,
      title: 'Network fees are low',
      message: `Bitcoin fees are about ${Math.ceil(f.halfHourFee)} sat/vB right now, a cheap moment to move on-chain bitcoin.`,
      mood: 'happy', tone: 'info', action: { label: 'Send', do: { kind: 'navigate', screen: 'Send' } },
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export type Dismissals = Record<string, number>;

/** Insights not dismissed within their cooldown, best first, at most `max`. */
export function visibleInsights(all: Insight[], dismissed: Dismissals, now: number, max = MAX_VISIBLE): Insight[] {
  return all.filter((i) => !(dismissed[i.key] != null && now - dismissed[i.key] < i.cooldownMs)).slice(0, max);
}

const STORE_PREFIX = 'rate.insights.dismissed.v1.';
const KEEP_MS = 400 * DAY;

export const dismissalStoreKey = (walletKey: string) => `${STORE_PREFIX}${walletKey}`;

export async function loadDismissals(walletKey: string | null): Promise<Dismissals> {
  if (!walletKey) return {};
  try {
    const raw = await AsyncStorage.getItem(dismissalStoreKey(walletKey));
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Dismissals;
  } catch {
    return {};
  }
}

export async function dismissInsight(walletKey: string | null, key: string, now = Date.now()): Promise<Dismissals> {
  const current = await loadDismissals(walletKey);
  const next: Dismissals = Object.fromEntries(Object.entries({ ...current, [key]: now }).filter(([, t]) => now - t < KEEP_MS));
  if (walletKey) {
    try { await AsyncStorage.setItem(dismissalStoreKey(walletKey), JSON.stringify(next)); } catch { /* shown again next launch */ }
  }
  return next;
}
