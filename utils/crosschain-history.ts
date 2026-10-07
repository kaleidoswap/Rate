/**
 * Cross-chain orders (bridge deposits and sends to other chains) as Activity
 * items. The in-flight sessions are cleared when a transfer finishes, so each
 * order is also kept here, per wallet, for the history.
 */
import type { OrchestraOrderStatus } from '../services/orchestra/client';
import type { BridgeState } from './bridge-session';
import type { CrossChainSendSession } from './crosschain-send';
import { formatSmallUnits, TERMINAL_STATUSES } from './orchestra-ui';

export type CrossChainDirection = 'deposit' | 'send';

export interface CrossChainRecord {
  /** quoteId: stable from the first save, before an order id exists. */
  id: string;
  direction: CrossChainDirection;
  sourceChain: string;
  sourceAsset: string;
  destChain: string;
  destAsset: string;
  amountInRaw: string;
  sourceDecimals: number;
  amountOutRaw?: string;
  destDecimals: number;
  recipient?: string;
  orderId?: string;
  readToken?: string;
  /** Orchestra status, or 'unpaid' for a send whose payment outcome isn't known yet. */
  status: OrchestraOrderStatus | 'unpaid';
  createdAt: number;
  updatedAt: number;
}

export const CROSSCHAIN_HISTORY_LIMIT = 100;

/** A bridge deposit is history once a deposit was detected; an unfunded quote isn't. */
export function recordFromBridge(state: BridgeState, now: number): CrossChainRecord | null {
  const { quote, order } = state;
  if (!quote || !order) return null;
  return {
    id: quote.quoteId,
    direction: 'deposit',
    sourceChain: state.sourceChain,
    sourceAsset: state.sourceAsset,
    destChain: 'spark',
    destAsset: state.destAsset,
    amountInRaw: order.amountIn ?? quote.amountIn,
    sourceDecimals: state.sourceDecimals ?? 0,
    amountOutRaw: order.amountOut ?? quote.estimatedOut,
    destDecimals: state.destDecimals ?? (state.destAsset === 'BTC' ? 8 : 6),
    orderId: order.id,
    readToken: order.readToken,
    status: order.status,
    createdAt: now,
    updatedAt: now,
  };
}

/** A send is history from the moment funds may leave Spark. */
export function recordFromSend(s: CrossChainSendSession): CrossChainRecord {
  return {
    id: s.quoteId,
    direction: 'send',
    sourceChain: 'spark',
    sourceAsset: s.source,
    destChain: s.destChain,
    destAsset: s.destToken,
    amountInRaw: s.sourceAmountRaw,
    sourceDecimals: s.source === 'BTC' ? 8 : 6,
    amountOutRaw: s.order?.amountOut ?? s.expectedOutRaw,
    destDecimals: s.destDecimals,
    recipient: s.recipient,
    orderId: s.order?.id,
    readToken: s.order?.readToken,
    // Moving on from an unconfirmed payment means it didn't go out.
    status: s.order?.status ?? (s.phase === 'paying' ? (s.dismissedAt ? 'failed' : 'unpaid') : 'processing'),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Insert or update by id, keeping the first createdAt; newest first, capped. */
export function upsertRecord(list: CrossChainRecord[], rec: CrossChainRecord): CrossChainRecord[] {
  const prev = list.find((r) => r.id === rec.id);
  const merged: CrossChainRecord = prev
    ? {
        ...prev,
        ...Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined)),
        createdAt: prev.createdAt,
      } as CrossChainRecord
    : rec;
  return [merged, ...list.filter((r) => r.id !== rec.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, CROSSCHAIN_HISTORY_LIMIT);
}

export function parseHistory(raw: string | null): CrossChainRecord[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((r) => r && typeof r.id === 'string' && typeof r.direction === 'string')
      : [];
  } catch {
    return [];
  }
}

export function isRecordFinal(rec: CrossChainRecord): boolean {
  return rec.status !== 'unpaid' && TERMINAL_STATUSES.has(rec.status);
}

export function activityStatusOf(rec: CrossChainRecord): 'confirmed' | 'failed' | 'pending' {
  if (rec.status === 'completed') return 'confirmed';
  if (rec.status === 'failed' || rec.status === 'refunded') return 'failed';
  return 'pending';
}

/** "1,000 USDT" — amounts are kept raw with their decimals. */
export function formatRecordAmount(raw: string | undefined, decimals: number, asset: string): string {
  if (!raw) return '';
  if (asset.toUpperCase() === 'BTC') return `${formatSmallUnits(raw, 0)} sats`;
  return `${formatSmallUnits(raw, decimals)} ${asset}`;
}
