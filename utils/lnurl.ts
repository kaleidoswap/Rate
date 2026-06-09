// utils/lnurl.ts
//
// LNURL-pay resolution: turn a Lightning address (user@domain) into a concrete
// BOLT11 invoice for a given amount. Spark/RGB protocols can only pay an
// invoice, never a `user@domain` string, so any send to a Lightning address has
// to resolve here first. Shared by the Send screen and the AI wallet tools.

const isLightningAddressInput = (s: string): boolean =>
  /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());

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
 * Resolve a Lightning address (`user@domain`) to a BOLT11 invoice for
 * `amountSats`, honoring the service's min/max sendable limits.
 */
export async function resolveLightningAddressToInvoice(
  address: string,
  amountSats: number,
  comment = '',
): Promise<string> {
  const trimmed = address.trim();
  if (!isLightningAddressInput(trimmed)) {
    throw new Error(`That doesn't look like a Lightning address: ${address}`);
  }
  if (!amountSats || amountSats <= 0) {
    throw new Error('Enter an amount to pay this Lightning address.');
  }

  const [username, domain] = trimmed.split('@');
  const lnurl = await fetchJson(`https://${domain}/.well-known/lnurlp/${username}`);
  if (lnurl?.status === 'ERROR') {
    throw new Error(lnurl.reason || 'Lightning address rejected the request.');
  }

  const msat = amountSats * 1000;
  if (lnurl?.minSendable && msat < lnurl.minSendable) {
    throw new Error(`Minimum is ${Math.ceil(lnurl.minSendable / 1000)} sats.`);
  }
  if (lnurl?.maxSendable && msat > lnurl.maxSendable) {
    throw new Error(`Maximum is ${Math.floor(lnurl.maxSendable / 1000)} sats.`);
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
