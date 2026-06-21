// utils/lnurl.ts
//
// LNURL-pay resolution: turn a Lightning address (user@domain) or a bech32
// LNURL (lnurl1...) into a concrete BOLT11 invoice for a given amount.
// Spark/RGB protocols can only pay an invoice, never a `user@domain` or
// `lnurl1...` string, so any send to such a destination has to resolve here
// first. Shared by the Send screen and the AI wallet tools.

import { bech32 } from '@scure/base';

const isLightningAddressInput = (s: string): boolean =>
  /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());

const isLnurlInput = (s: string): boolean =>
  s.trim().toLowerCase().startsWith('lnurl1');

async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Lightning address endpoint returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decode a bech32-encoded LNURL (`lnurl1...`) to its underlying URL.
 * Bech32 is case-insensitive; QR codes frequently carry it uppercased.
 */
export function decodeLnurlBech32(input: string): string {
  const decoded = bech32.decode(input.trim().toLowerCase() as `lnurl1${string}`, 2048);
  const bytes = bech32.fromWords(decoded.words);
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// Fetch the LNURL-pay parameters (callback, min/max) for either destination
// form. Both LUD-16 (user@domain → /.well-known/lnurlp/<user>) and LUD-06
// (bech32 LNURL → decoded URL) return the same payRequest JSON shape.
async function fetchPayParams(destination: string): Promise<any> {
  if (isLnurlInput(destination)) {
    const url = decodeLnurlBech32(destination);
    const params = await fetchJson(url);
    if (params?.status === 'ERROR') {
      throw new Error(params.reason || 'LNURL endpoint returned an error.');
    }
    if (params?.tag === 'withdrawRequest') {
      throw new Error('This is an LNURL-withdraw code, not a payment request.');
    }
    if (params?.tag !== 'payRequest') {
      throw new Error(`Unsupported LNURL type: ${params?.tag || 'unknown'}`);
    }
    return params;
  }

  // LUD-16 usernames are lowercase by spec; QR codes may uppercase the whole
  // address, so normalize before building the well-known URL.
  const [username, domain] = destination.toLowerCase().split('@');
  const params = await fetchJson(`https://${domain}/.well-known/lnurlp/${username}`);
  if (params?.status === 'ERROR') {
    throw new Error(params.reason || 'Lightning address rejected the request.');
  }
  return params;
}

/**
 * Resolve a Lightning address (`user@domain`) or bech32 LNURL (`lnurl1...`)
 * to a BOLT11 invoice for `amountSats`, honoring the service's min/max
 * sendable limits.
 */
export async function resolveLightningAddressToInvoice(
  address: string,
  amountSats: number,
  comment = '',
): Promise<string> {
  let trimmed = address.trim();
  // Unwrap a `lightning:` URI scheme (QR codes often wrap the destination).
  if (/^lightning:/i.test(trimmed)) {
    trimmed = trimmed.replace(/^lightning:(\/\/)?/i, '').trim();
  }
  if (!isLightningAddressInput(trimmed) && !isLnurlInput(trimmed)) {
    throw new Error(`That doesn't look like a Lightning address or LNURL: ${address}`);
  }
  if (!amountSats || amountSats <= 0) {
    throw new Error('Enter an amount to pay this Lightning address.');
  }

  const lnurl = await fetchPayParams(trimmed);

  const msat = amountSats * 1000;
  if (lnurl?.minSendable && msat < lnurl.minSendable) {
    throw new Error(`Minimum is ${Math.ceil(lnurl.minSendable / 1000)} sats.`);
  }
  if (lnurl?.maxSendable && msat > lnurl.maxSendable) {
    throw new Error(`Maximum is ${Math.floor(lnurl.maxSendable / 1000)} sats.`);
  }
  if (!lnurl?.callback) {
    throw new Error('The Lightning service returned no payment callback.');
  }

  const sep = String(lnurl.callback).includes('?') ? '&' : '?';
  const inv = await fetchJson(`${lnurl.callback}${sep}amount=${msat}&comment=${encodeURIComponent(comment)}`);
  if (inv?.status === 'ERROR') {
    throw new Error(inv.reason || 'Could not get an invoice from the Lightning address.');
  }
  if (!inv?.pr) {
    throw new Error('The Lightning address returned no invoice.');
  }
  return String(inv.pr);
}
