import { Address, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { bech32, bech32m } from '@scure/base';
import { decodeOffer, offerRails, paymentCodeNetwork } from '@universal-bolt12/universal-code';
import { decodeBolt11 } from '../../utils/decodeInvoice';
import { invoiceExpiry } from '../../components/payments/InvoiceExpiry';
import { ARK_ADDRESS, LIGHTNING_ADDRESS, SPARK_ADDRESS } from '../../utils/account-routing';

/**
 * What the user pasted or scanned, decoded into one payment target. Every kind of
 * request the wallet can pay is a target, so Send has one flow for all of them.
 */
export type TargetKind = 'bolt11' | 'lnurl' | 'offer' | 'bitcoin' | 'spark' | 'ark' | 'rgb';

/** Chains a code can be for. A test-network code can't tell signet, mutinynet and testnet apart. */
export type ChainNetwork = 'mainnet' | 'signet' | 'mutinynet' | 'testnet' | 'regtest';
export const TEST_NETWORKS: ChainNetwork[] = ['signet', 'mutinynet', 'testnet'];

export interface PayTarget {
  kind: TargetKind;
  raw: string;
  /** Networks the code may be for; undefined when it does not say (RGB invoices, LN addresses). */
  networks?: ChainNetwork[];
  /** Amount the code fixes, in sats. */
  amountSat?: number;
  /** BOLT11 invoice (also the resolved invoice of a Lightning address). */
  invoice?: string;
  invoiceExpiresAt?: number;
  description?: string;
  /** Lightning address or LNURL, resolved to an invoice once the amount is known. */
  lnurl?: string;
  /** Bitcoin address. */
  address?: string;
  /** BOLT12 offer. */
  offer?: string;
  sparkAddress?: string;
  arkAddress?: string;
  rgbInvoice?: string;
  label?: string;
  message?: string;
}

const strip = (text: string) => text.trim().replace(/^lightning:(\/\/)?/i, '').trim();

function bolt11Networks(invoice: string): ChainNetwork[] | undefined {
  const lower = invoice.toLowerCase();
  if (lower.startsWith('lnbcrt')) return ['regtest'];
  if (lower.startsWith('lnbc')) return ['mainnet'];
  if (lower.startsWith('lntb')) return TEST_NETWORKS;
  return undefined;
}

/** Networks a valid bitcoin address belongs to, or null when it is not a valid address. */
export function bitcoinAddressNetworks(address: string): ChainNetwork[] | null {
  const a = address.trim();
  if (/^bcrt1/i.test(a)) {
    for (const codec of [bech32, bech32m]) {
      try { if (codec.decode(a.toLowerCase() as `${string}1${string}`).prefix === 'bcrt') return ['regtest']; } catch { /* next */ }
    }
    return null;
  }
  try { Address(NETWORK).decode(a); return ['mainnet']; } catch { /* test below */ }
  try { Address(TEST_NETWORK).decode(a); return TEST_NETWORKS; } catch { return null; }
}

function sparkNetworks(address: string): ChainNetwork[] {
  const prefix = /^([a-z]+)1/i.exec(address)?.[1].toLowerCase() ?? '';
  if (prefix === 'spark' || prefix === 'sp') return ['mainnet'];
  if (prefix.endsWith('rt')) return ['regtest'];
  return TEST_NETWORKS;
}

/** Liquid addresses, recognized only to say plainly that this wallet doesn't pay them. */
function isLiquidAddress(address: string): boolean {
  return /^(lq1|ex1|tlq1|tex1|el1|ert1)[a-z0-9]{20,}$/i.test(address) || /^[VGHQ][1-9A-HJ-NP-Za-km-z]{30,}$/.test(address);
}


function fromInvoice(invoice: string, raw: string): PayTarget {
  const expiresAt = invoiceExpiry(invoice);
  if (expiresAt !== null && expiresAt <= Date.now()) throw new Error('This invoice has expired. Please request a new one.');
  const decoded = decodeBolt11(invoice);
  if (decoded.amountSats === undefined && decoded.expirySec === undefined && !decoded.description && !/^ln/i.test(invoice)) {
    throw new Error('This Lightning invoice could not be read.');
  }
  return {
    kind: 'bolt11', raw, invoice,
    networks: bolt11Networks(invoice),
    amountSat: decoded.amountSats || undefined,
    description: decoded.description,
  };
}

function parseBip21(text: string): PayTarget {
  const body = text.slice(text.indexOf(':') + 1);
  const [addressPart, query = ''] = body.split('?');
  const params = new Map<string, string>();
  for (const part of query.split('&').filter(Boolean)) {
    const eq = part.indexOf('=');
    const key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq)).toLowerCase();
    if (params.has(key)) throw new Error(`Ambiguous duplicate parameter: ${key}`);
    params.set(key, decodeURIComponent(eq < 0 ? '' : part.slice(eq + 1)));
  }
  for (const key of params.keys()) if (key.startsWith('req-')) throw new Error(`Unsupported required parameter: ${key}`);
  // A token request must never be paid as plain bitcoin.
  if (params.has('assetid') || params.has('assetamount')) throw new Error('This request asks for a token, which is not a recognized payment here.');
  const target: PayTarget = { kind: 'bitcoin', raw: text, label: params.get('label'), message: params.get('message') };
  const address = decodeURIComponent(addressPart);
  if (address) {
    const networks = bitcoinAddressNetworks(address);
    if (!networks) throw new Error('This bitcoin address is not valid.');
    target.address = address;
    target.networks = networks;
  }
  if (params.has('amount')) {
    const amount = params.get('amount')!;
    if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) throw new Error('Invalid BTC amount');
    const [whole, fraction = ''] = amount.split('.');
    const sat = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
    if (sat <= 0n || sat > 2100000000000000n) throw new Error('Invalid BTC amount');
    target.amountSat = Number(sat);
  }
  const lightning = params.get('lightning');
  if (lightning) {
    const ln = strip(lightning);
    if (/^lno1/i.test(ln)) target.offer = ln;
    else if (/^ln/i.test(ln)) {
      const inv = fromInvoice(ln, ln);
      target.invoice = ln;
      target.networks ??= inv.networks;
      target.description ??= inv.description;
      if (inv.amountSat !== undefined && target.amountSat !== undefined && inv.amountSat !== target.amountSat) {
        throw new Error('The payment code asks for two different amounts.');
      }
      target.amountSat ??= inv.amountSat;
    }
  }
  if (params.get('lno')) target.offer = params.get('lno');
  if (params.get('spark') && SPARK_ADDRESS.test(params.get('spark')!)) target.sparkAddress = params.get('spark');
  if (params.get('ark') && ARK_ADDRESS.test(params.get('ark')!)) target.arkAddress = params.get('ark');
  if (target.offer) target.kind = 'offer';
  if (!target.address && !target.invoice && !target.offer && !target.sparkAddress && !target.arkAddress) {
    throw new Error('This payment code has nothing to pay.');
  }
  return target;
}

/** An offer's chain (BOLT12: no chains field means bitcoin mainnet). */
function offerNetworks(offer: string): ChainNetwork[] {
  try {
    const network = paymentCodeNetwork(offer) as ChainNetwork | undefined;
    return network ? [network] : ['mainnet'];
  } catch { return ['mainnet']; }
}

/** The amount a BOLT12 offer fixes, in whole sats; undefined for an open-amount offer. */
export function offerAmountSat(offer: string): number | undefined {
  const fields = decodeOffer(offer);
  if (fields.some(f => f.type === 6n)) throw new Error('This offer is priced in another currency, which this wallet cannot pay.');
  const encoded = fields.find(f => f.type === 8n)?.value;
  if (!encoded) return undefined;
  if (encoded.length === 0 || encoded.length > 8 || encoded[0] === 0) throw new Error('This offer has an invalid amount.');
  const msat = encoded.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
  if (msat === 0n || msat % 1000n !== 0n || msat / 1000n > 2100000000000000n) throw new Error('This offer asks for an amount that cannot be paid in whole sats.');
  return Number(msat / 1000n);
}

/**
 * Decode anything the user can pay: BOLT11, Lightning address / LNURL, BOLT12, bitcoin
 * address or BIP21 (with lightning=/lno=/spark=/ark=), Spark, Ark or RGB invoice.
 * Throws a readable error for anything else.
 */
export function decodeTarget(text: string): PayTarget {
  const raw = text.trim();
  if (!raw) throw new Error('Paste or scan something to pay.');
  const code = strip(raw);
  const lower = code.toLowerCase();
  if (lower.startsWith('bitcoin:')) {
    const target = parseBip21(code);
    if (target.offer) {
      decodeOffer(target.offer);
      const offerSat = offerAmountSat(target.offer);
      if (offerSat !== undefined && target.amountSat !== undefined && offerSat !== target.amountSat) {
        throw new Error('The payment code asks for two different amounts.');
      }
      target.amountSat ??= offerSat;
      target.networks ??= offerNetworks(target.offer);
    }
    return target;
  }
  if (lower.startsWith('lno1')) {
    decodeOffer(code);
    return { kind: 'offer', raw, offer: code, amountSat: offerAmountSat(code), networks: offerNetworks(code) };
  }
  if (lower.startsWith('lnurl1') || LIGHTNING_ADDRESS.test(code)) return { kind: 'lnurl', raw, lnurl: code };
  if (lower.startsWith('ln')) return fromInvoice(code, raw);
  if (lower.startsWith('rgb:') || lower.startsWith('rgb1')) return { kind: 'rgb', raw, rgbInvoice: code };
  if (ARK_ADDRESS.test(code)) return { kind: 'ark', raw, arkAddress: code, networks: lower.startsWith('tark') ? [...TEST_NETWORKS, 'regtest'] : ['mainnet'] };
  if (SPARK_ADDRESS.test(code)) return { kind: 'spark', raw, sparkAddress: code, networks: sparkNetworks(code) };
  if (isLiquidAddress(code)) throw new Error("Liquid addresses aren't supported by this wallet.");
  const btc = bitcoinAddressNetworks(code);
  if (btc) return { kind: 'bitcoin', raw, address: code, networks: btc };
  throw new Error("This isn't something this wallet can pay.");
}

/** Receiver-listed rails of an offer, in the receiver's order (Ark rails only with an address). */
export function targetOfferRails(target: PayTarget): { rail: string; address?: string }[] {
  return target.offer ? offerRails(target.offer).filter(r => r.address || !/^(arkade|bark):/.test(r.rail)) : [];
}
