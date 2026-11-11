import type { ActivityItem, ActivityItemType } from '../services/ActivityService';
import { AGENT_ACTIVITY_KIND } from '../services/agentWallet/activity';
import { rgbOnchainKindLabel } from './rgb-wallet';

/** One visual identity per activity type, shared by every view of it. */
export type ActivityIconTone = 'receive' | 'sent' | 'swap' | 'accent' | 'warning' | 'neutral';
export type ActivityIconName = 'arrow-down' | 'arrow-up' | 'swap-horizontal' | 'add-circle-outline' | 'git-branch-outline' | 'close-circle-outline' | 'ellipse-outline';

export function activityIcon(type: ActivityItemType): { icon: ActivityIconName; tone: ActivityIconTone } {
  switch (type) {
    case 'receive': return { icon: 'arrow-down', tone: 'receive' };
    case 'send': return { icon: 'arrow-up', tone: 'sent' };
    case 'swap': return { icon: 'swap-horizontal', tone: 'swap' };
    case 'issuance': return { icon: 'add-circle-outline', tone: 'accent' };
    case 'channel_open': return { icon: 'git-branch-outline', tone: 'accent' };
    case 'channel_close': return { icon: 'close-circle-outline', tone: 'warning' };
    default: return { icon: 'ellipse-outline', tone: 'neutral' };
  }
}

/** The theme color of a tone, so icon and amount stay in step everywhere. */
export function activityToneColor(tone: ActivityIconTone, t: {
  colors: {
    tx: { receive: string; sent: string; swap: string };
    accent: { 500: string }; warning: { 500: string }; text: { tertiary: string };
  };
}): string {
  switch (tone) {
    case 'receive': return t.colors.tx.receive;
    case 'sent': return t.colors.tx.sent;
    case 'swap': return t.colors.tx.swap;
    case 'accent': return t.colors.accent[500];
    case 'warning': return t.colors.warning[500];
    default: return t.colors.text.tertiary;
  }
}

/** One name per activity, in rows, widgets and detail sheets alike. */
export function activityTypeLabel(item: ActivityItem): string {
  if (item.crossChain) return item.crossChain.direction === 'deposit' ? 'Deposit from another chain' : 'Sent to another chain';
  if (item.kind === 'unilateral_exit') return 'Exit to Bitcoin';
  if (item.kind === AGENT_ACTIVITY_KIND && item.assetName) return item.assetName;
  const onchainKind = item.source === 'onchain' ? rgbOnchainKindLabel(item.kind) : null;
  if (onchainKind) return onchainKind;
  switch (item.type) {
    case 'receive': return 'Received';
    case 'send': return 'Payment';
    case 'swap': return 'Swap';
    case 'issuance': return item.kind === 'Inflation' ? 'Inflation' : 'Issuance';
    case 'channel_open': return 'Channel Open';
    case 'channel_close': return 'Channel Close';
    default: return 'Transaction';
  }
}

/** + for money in, − for money out; swaps and channel moves carry no sign. */
export function activityAmountPrefix(type: ActivityItemType): string {
  if (type === 'receive' || type === 'issuance') return '+';
  if (type === 'send') return '−';
  return '';
}

/** Whether the amount line reads as money in (green) or stays neutral. */
export function activityAmountIsIncoming(type: ActivityItemType): boolean {
  return type === 'receive' || type === 'issuance';
}

/** One compact age everywhere rows are shown; the detail sheet shows the full date. */
export function activityShortTime(ts: number | undefined, now = Date.now()): string {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 48 * 3_600_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
