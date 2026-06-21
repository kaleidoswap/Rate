// Detect + decode "payables" (Lightning invoices, on-chain addresses, RGB
// invoices, Lightning addresses, LNURL) in free text, so the chat can render a
// rich card instead of a wall of bech32.

import { decode } from 'light-bolt11-decoder';

export type PayableKind = 'bolt11' | 'onchain' | 'rgb' | 'lnaddress' | 'lnurl';

export interface Payable {
  kind: PayableKind;
  raw: string;
  amountSats?: number;
  description?: string;
  /** Seconds until expiry, from the invoice. */
  expirySec?: number;
  network?: string;
}

const RE: Record<PayableKind, RegExp> = {
  bolt11: /\bln(bc|tb|bcrt)[0-9a-z]{50,}\b/i,
  rgb: /\brgb:[0-9a-zA-Z\-_:/+]+/i,
  lnurl: /\blnurl[0-9a-z]{20,}\b/i,
  onchain: /\b(bc1|tb1|bcrt1)[0-9a-z]{20,}\b/i,
  lnaddress: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
};

/** Decode a BOLT11 invoice to { amountSats, description, expirySec, network }. */
export function decodeBolt11(invoice: string): Payable {
  try {
    const d: any = decode(invoice.trim());
    const sec = (n: string) => d.sections?.find((s: any) => s.name === n)?.value;
    const msat = sec('amount');
    return {
      kind: 'bolt11',
      raw: invoice.trim(),
      amountSats: msat ? Math.round(Number(msat) / 1000) : undefined,
      description: sec('description') || undefined,
      expirySec: Number(sec('expiry')) || undefined,
      network: d.network || (invoice.toLowerCase().startsWith('lnbc') ? 'mainnet' : 'signet/test'),
    };
  } catch {
    return { kind: 'bolt11', raw: invoice.trim() };
  }
}

/** The first payable found in a block of text, or null. Order = most specific first. */
export function findPayable(text: string): Payable | null {
  const m11 = text.match(RE.bolt11);
  if (m11) return decodeBolt11(m11[0]);
  const rgb = text.match(RE.rgb);
  if (rgb) return { kind: 'rgb', raw: rgb[0] };
  const lnurl = text.match(RE.lnurl);
  if (lnurl) return { kind: 'lnurl', raw: lnurl[0] };
  const onc = text.match(RE.onchain);
  if (onc) return { kind: 'onchain', raw: onc[0] };
  const la = text.match(RE.lnaddress);
  if (la) return { kind: 'lnaddress', raw: la[0] };
  return null;
}

/** Text with the payable string removed (so the card isn't duplicated by a wall of bech32). */
export function stripPayable(text: string, p: Payable): string {
  return text.replace(p.raw, '').replace(/:\s*$/, '').replace(/\n{3,}/g, '\n\n').trim();
}

export const KIND_LABEL: Record<PayableKind, string> = {
  bolt11: 'Lightning invoice',
  onchain: 'Bitcoin address',
  rgb: 'RGB invoice',
  lnaddress: 'Lightning address',
  lnurl: 'LNURL',
};
