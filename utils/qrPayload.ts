// utils/qrPayload.ts
//
// What goes into a payment QR. Upper case lets the QR use its alphanumeric
// mode: fewer, larger modules that scan faster (Bitcoin Design Guide). Only
// parts that are case-insensitive are upper-cased — the bitcoin: scheme,
// bech32/bech32m addresses, BOLT11/BOLT12 invoices and LNURLs. Base58
// addresses, RGB invoices and free text (label, message) keep their case.

const BECH32_ADDRESS = /^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]+$/i;
const LIGHTNING = /^(lnbc|lntbs|lntb|lnbcrt|lno1|lnurl)[0-9a-z]+$/i;
const UPPER_PARAMS = new Set(['lightning', 'lno']);

export function qrPayload(value: string): string {
  const v = value.trim();
  if (LIGHTNING.test(v)) return v.toUpperCase();
  const lightningUri = /^lightning:(.+)$/i.exec(v);
  if (lightningUri && LIGHTNING.test(lightningUri[1])) return `LIGHTNING:${lightningUri[1].toUpperCase()}`;
  const bitcoinUri = /^bitcoin:([^?]*)(\?.*)?$/i.exec(v);
  if (!bitcoinUri) return v;
  const address = BECH32_ADDRESS.test(bitcoinUri[1]) ? bitcoinUri[1].toUpperCase() : bitcoinUri[1];
  const query = (bitcoinUri[2] ?? '').replace(/([?&])([^=&]+)=([^&]*)/g, (all, sep, key, val) =>
    UPPER_PARAMS.has(key.toLowerCase()) && LIGHTNING.test(val) ? `${sep}${key}=${val.toUpperCase()}` : all);
  return `BITCOIN:${address}${query}`;
}
