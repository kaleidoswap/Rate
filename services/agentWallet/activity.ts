// The Agent wallet's log as Activity rows.

import type { ActivityItem } from '../ActivityService';
import type { AgentLedgerEntry } from './store';

export const AGENT_ACTIVITY_KIND = 'agent-wallet';

const formatSats = (sats: number) => sats.toLocaleString('en-US', { maximumFractionDigits: 0 });

const STATUS: Record<AgentLedgerEntry['status'], ActivityItem['status'] | null> = {
  paid: 'confirmed',
  pending: 'pending',
  failed: 'failed',
  refused: null,
  cancelled: null,
};

export function agentEntryTitle(e: Pick<AgentLedgerEntry, 'kind' | 'service'>): string {
  if (e.kind === 'topup') return 'Agent wallet top-up';
  if (e.kind === 'withdraw') return 'Agent wallet withdrawal';
  return e.service ? `Agent paid ${e.service}` : 'Agent payment';
}

/** Payments, top-ups and withdrawals; refused and declined attempts stay in the Agent wallet log. */
export function agentActivityItems(entries: AgentLedgerEntry[], opts: { spendsOnly?: boolean } = {}): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const e of entries) {
    const status = STATUS[e.status];
    if (!status || (opts.spendsOnly && e.kind !== 'spend')) continue;
    items.push({
      id: `agent-${e.id}`,
      type: e.kind === 'withdraw' ? 'receive' : 'send',
      source: 'payment',
      asset: 'BTC',
      assetName: agentEntryTitle(e),
      assetTicker: 'sats',
      assetPrecision: 0,
      amount: formatSats(e.amountSats),
      rawSats: e.amountSats,
      status,
      timestamp: e.at,
      txid: e.paymentHash ?? '',
      layer: 'Spark',
      fee: e.feeSats || undefined,
      account: 'Agent wallet',
      paymentHash: e.kind === 'spend' ? e.paymentHash : undefined,
      kind: AGENT_ACTIVITY_KIND,
    });
  }
  return items;
}
