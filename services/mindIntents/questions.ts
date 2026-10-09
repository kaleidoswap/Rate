// Answers to questions, computed from the wallet's own data (balances and the
// Activity list), never from a model.

import type { ActivityItem } from '../ActivityService';
import type { IntentPeriod, MindIntent } from './schema';

export interface AnswerRow { label: string; sat?: number; units?: number; unit?: string; detail?: string }

export interface AnswerCard {
  kind: 'balance' | 'spending';
  title: string;
  /** Headline amount in sats. */
  totalSat?: number;
  rows: AnswerRow[];
  note?: string;
}

export interface BalanceInput {
  totalSat: number;
  byAccount: Record<string, number>;
  assets: { ticker: string; amount: number }[];
  /** Advanced mode names accounts; Lite keeps one total. */
  advanced: boolean;
}

const ACCOUNT_NAME: Record<string, string> = { RGB: 'RGB', SPARK: 'Spark', ARKADE: 'Arkade', BARK: 'Bark' };

export function answerBalance(intent: MindIntent, input: BalanceInput): AnswerCard {
  const rows: AnswerRow[] = [];
  if (intent.asset && intent.asset !== 'BTC') {
    const held = input.assets.filter((a) => a.ticker.toUpperCase() === intent.asset);
    const amount = held.reduce((s, a) => s + a.amount, 0);
    return { kind: 'balance', title: `Your ${intent.asset}`, rows: [{ label: intent.asset, units: amount, unit: intent.asset }] };
  }
  if (input.advanced) {
    for (const [id, sat] of Object.entries(input.byAccount)) if (sat > 0) rows.push({ label: ACCOUNT_NAME[id] ?? id, sat });
  }
  for (const a of input.assets) if (a.amount > 0) rows.push({ label: a.ticker, units: a.amount, unit: a.ticker });
  return { kind: 'balance', title: 'Your balance', totalSat: input.totalSat, rows };
}

const DAY = 86_400_000;

export function periodStart(period: IntentPeriod, now: number): number {
  const d = new Date(now);
  switch (period) {
    case 'today': return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case 'week': return now - 7 * DAY;
    case 'month': return now - 30 * DAY;
    case 'year': return now - 365 * DAY;
    default: return 0;
  }
}

const PERIOD_LABEL: Record<IntentPeriod, string> = {
  today: 'today', week: 'in the last 7 days', month: 'in the last 30 days', year: 'in the last year', all: 'in total',
};

const unitsOf = (item: ActivityItem) => {
  const n = Number(String(item.amount).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export interface SpendingSummary { totalSat: number; feeSat: number; count: number; assets: Record<string, number>; largestSat?: number }

/** Money out (or in) over the period: confirmed and pending payments, never swaps or failed ones. */
export function summarizeActivity(items: ActivityItem[], period: IntentPeriod, direction: 'out' | 'in', now = Date.now()): SpendingSummary {
  const from = periodStart(period, now);
  const type = direction === 'out' ? 'send' : 'receive';
  const picked = items.filter((i) => i.type === type && i.status !== 'failed' && (i.timestamp ?? 0) >= from && (i.timestamp ?? 0) <= now);
  const summary: SpendingSummary = { totalSat: 0, feeSat: 0, count: picked.length, assets: {} };
  for (const i of picked) {
    if (i.asset === 'BTC' || i.rawSats != null) {
      const sat = i.rawSats ?? 0;
      summary.totalSat += sat;
      summary.largestSat = Math.max(summary.largestSat ?? 0, sat);
      if (direction === 'out') summary.feeSat += i.fee ?? 0;
    } else {
      summary.assets[i.assetTicker] = (summary.assets[i.assetTicker] ?? 0) + unitsOf(i);
    }
  }
  return summary;
}

export function answerSpending(intent: MindIntent, items: ActivityItem[], now = Date.now()): AnswerCard {
  const period = intent.period ?? 'week';
  const direction = intent.direction ?? 'out';
  const s = summarizeActivity(items, period, direction, now);
  const verb = direction === 'out' ? 'Spent' : 'Received';
  const rows: AnswerRow[] = [];
  for (const [ticker, units] of Object.entries(s.assets)) rows.push({ label: ticker, units, unit: ticker });
  if (direction === 'out' && s.feeSat > 0) rows.push({ label: 'Fees', sat: s.feeSat });
  if (s.largestSat) rows.push({ label: 'Largest', sat: s.largestSat });
  const count = `${s.count} ${s.count === 1 ? 'payment' : 'payments'}`;
  return {
    kind: 'spending',
    title: `${verb} ${PERIOD_LABEL[period]}`,
    totalSat: s.totalSat,
    rows,
    note: s.count === 0 ? `No ${direction === 'out' ? 'payments sent' : 'payments received'} ${PERIOD_LABEL[period]}.` : count,
  };
}
