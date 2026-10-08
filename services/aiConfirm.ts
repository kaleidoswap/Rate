// What the assistant's confirm sheet shows (and speaks) before a tool moves
// funds, built from the tool call plus the app's own state: the cached swap
// quote, the resolved contact, the decoded invoice. Shared by chat and voice.

import { decodeBolt11 } from '../utils/decodeInvoice';
import { describeSwapQuote, type SwapQuoteView } from './swapTools';
import { previewSendPayment, lightningRailLabel, type SendPreview } from './walletTools';

export interface ReadbackRow {
  label: string;
  value: string;
  /** Long values (invoices, addresses) render truncated with copy/expand. */
  copyable?: boolean;
}

export interface ConfirmReadback {
  kind: 'payment' | 'swap' | 'asset' | 'other';
  title: string;
  cta: string;
  /** Headline amount, e.g. "5,000 sats" or "20 USDT". */
  amount?: string;
  /** BTC value in sats when known (fiat line + auth threshold). */
  amountSats?: number;
  recipientName?: string;
  rows: ReadbackRow[];
  /** Swap quotes: venue expiry, ms since epoch. */
  expiresAt?: number;
  quoteId?: string;
  /** Swap: the receive amount shown, to compare against a re-quote. */
  shownReceive?: number;
  warning?: string;
  /** Plain sentence for the voice readback. */
  spoken: string;
}

const fmt = (n: number, max = 8) => n.toLocaleString('en-US', { maximumFractionDigits: max });
export const formatSats = (sats: number) => `${fmt(Math.round(sats), 0)} sats`;
const unitAmount = (n: number, unit: string) => (unit === 'sats' ? formatSats(n) : `${fmt(n)} ${unit}`);

const VENUE_LABEL: Record<string, string> = { kaleidoswap: 'KaleidoSwap', flashnet: 'Flashnet' };
const LAYER_LABEL: Record<string, string> = {
  BTC_LN: 'Lightning',
  RGB_LN: 'RGB Lightning',
  BTC_L1: 'Bitcoin on-chain',
  RGB_L1: 'RGB on-chain',
  Spark: 'Spark',
};
const layerLabel = (l?: string) => (l ? LAYER_LABEL[l] ?? l : undefined);

function decodeAmount(invoice: string): { sats?: number; description?: string } {
  if (!/^ln(bc|tb|bcrt)/i.test(invoice)) return {};
  try {
    const d = decodeBolt11(invoice);
    return { sats: d.amountSats || undefined, description: d.description || undefined };
  } catch {
    return {};
  }
}

const KIND_LABEL: Record<SendPreview['kind'], string> = {
  lightning_address: 'Lightning address',
  lightning_invoice: 'Lightning invoice',
  onchain: 'Bitcoin address',
  other: 'Destination',
};

export function paymentReadback(p: {
  preview: SendPreview;
  amountSats?: number;
  network: string;
  description?: string;
}): ConfirmReadback {
  const invoice = decodeAmount(p.preview.destination);
  const sats = p.amountSats || invoice.sats;
  const who = p.preview.recipientName ?? (p.preview.kind === 'lightning_address' ? p.preview.destination : undefined);
  const rows: ReadbackRow[] = [];
  if (p.preview.recipientName) rows.push({ label: 'Contact', value: p.preview.recipientName });
  rows.push({ label: KIND_LABEL[p.preview.kind], value: p.preview.destination, copyable: true });
  rows.push({ label: 'Asset', value: 'BTC' });
  rows.push({ label: 'Network', value: p.network });
  rows.push({ label: 'Fee', value: 'Lightning routing fee, set by the route' });
  const description = p.description ?? invoice.description;
  if (description) rows.push({ label: 'Note', value: description });
  return {
    kind: 'payment',
    title: 'Confirm payment',
    cta: 'Send',
    amount: sats ? formatSats(sats) : undefined,
    amountSats: sats,
    recipientName: who,
    rows,
    spoken: `Send ${sats ? formatSats(sats) : 'this payment'}${who ? ` to ${who}` : ''}. Tap to approve.`,
  };
}

export function swapReadback(q: SwapQuoteView, warning?: string): ConfirmReadback {
  const sendUnit = q.from === 'BTC' ? 'sats' : q.from;
  const send = unitAmount(q.sendAmount, sendUnit);
  const receive = unitAmount(q.receiveAmount, q.receiveUnit);
  const venue = VENUE_LABEL[q.venue] ?? q.venue;
  const rows: ReadbackRow[] = [
    { label: 'You send', value: [send, layerLabel(q.fromLayer)].filter(Boolean).join(' · ') },
    { label: 'You receive', value: [receive, layerLabel(q.toLayer)].filter(Boolean).join(' · ') },
    { label: 'Fee', value: q.fee != null && q.feeUnit ? unitAmount(q.fee, q.feeUnit) : 'Included in the price' },
    { label: 'Venue', value: venue },
  ];
  return {
    kind: 'swap',
    title: 'Confirm swap',
    cta: 'Swap',
    amount: send,
    amountSats: q.from === 'BTC' ? Math.round(q.sendAmount) : undefined,
    rows,
    expiresAt: q.expiresAt,
    quoteId: q.quoteId,
    shownReceive: q.receiveAmount,
    warning,
    spoken: `Swap ${send} for ${receive} on ${venue}. Tap to approve.`,
  };
}

export function assetSendReadback(a: { asset: string; amount: number; to: string; network: string }): ConfirmReadback {
  const amount = `${fmt(a.amount)} ${a.asset}`;
  return {
    kind: 'asset',
    title: 'Send asset',
    cta: 'Send',
    amount,
    rows: [
      { label: 'RGB invoice', value: a.to, copyable: true },
      { label: 'Asset', value: a.asset },
      { label: 'Network', value: a.network },
    ],
    spoken: `Send ${amount} to the RGB invoice you gave. Tap to approve.`,
  };
}

export function genericReadback(name: string, args: Record<string, unknown>): ConfirmReadback {
  const rows = Object.entries(args).map(([k, v]) => ({
    label: k.replace(/_/g, ' '),
    value: typeof v === 'string' ? v : JSON.stringify(v),
    copyable: typeof v === 'string' && v.length > 40,
  }));
  return {
    kind: 'other',
    title: 'Confirm action',
    cta: 'Approve',
    rows,
    spoken: `Approve ${name.replace(/_/g, ' ')}? Tap to approve.`,
  };
}

/**
 * Build the readback for a confirmation-gated call. Throws when the call cannot
 * be carried out as asked (unknown contact, expired quote): the caller declines
 * it with that message instead of showing an empty sheet.
 */
export async function buildConfirmReadback(call: { name: string; arguments: Record<string, unknown> }): Promise<ConfirmReadback> {
  const a = call.arguments ?? {};
  switch (call.name) {
    case 'send_payment': {
      const preview = await previewSendPayment(a.to);
      if (preview.kind === 'onchain') throw new Error("On-chain sends from the assistant aren't supported yet — use the Send screen.");
      return paymentReadback({ preview, amountSats: Number(a.amount_sats) || undefined, network: lightningRailLabel() });
    }
    case 'rln_pay_invoice':
    case 'spark_pay_invoice': {
      const invoice = String(a.invoice ?? a.to ?? '').trim();
      if (!invoice) throw new Error('An invoice is required.');
      return paymentReadback({
        preview: { destination: invoice, kind: 'lightning_invoice' },
        amountSats: Number(a.amount_sats) || undefined,
        network: lightningRailLabel(),
      });
    }
    case 'rln_send_asset':
      return assetSendReadback({
        asset: String(a.asset ?? '').toUpperCase(),
        amount: Number(a.amount) || 0,
        to: String(a.to ?? ''),
        network: 'RGB Lightning',
      });
    case 'execute_swap': {
      const q = describeSwapQuote(String(a.quote_id ?? ''));
      if (!q) throw new Error('That quote is no longer available — please get a fresh quote first.');
      return swapReadback(q);
    }
    default:
      return genericReadback(call.name, a);
  }
}

/**
 * Whether approving needs biometrics/PIN on top of the hold. Spends of unknown
 * BTC value (assets, swaps out of an asset) always do; 0 means always.
 */
export function requiresStrongAuth(r: Pick<ConfirmReadback, 'amountSats' | 'kind'>, thresholdSats: number): boolean {
  if (!(thresholdSats > 0)) return true;
  if (r.amountSats == null) return true;
  return r.amountSats >= thresholdSats;
}

export function secondsLeft(expiresAt: number | undefined, now = Date.now()): number | undefined {
  if (expiresAt == null) return undefined;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/** "Price changed by 1.6% since the quote" — shown when a re-quote moved past tolerance. */
export function priceChangeWarning(move: number): string {
  const pct = Math.abs(move * 100).toFixed(move * 100 < 1 ? 2 : 1);
  return move > 0
    ? `The price moved ${pct}% against you since the quote. Check the new amounts and approve again.`
    : `The price moved ${pct}% since the quote. Check the new amounts and approve again.`;
}
