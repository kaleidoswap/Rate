import { SimplePool, finalizeEvent, getPublicKey, nip04 } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { SwapNetwork, SwapOffer } from './types';

export const OFFER_KIND = 30315;
export const REQUEST_KIND = 25582;
export const OFFER_D_TAG = 'electrum-swapserver-5';
export const DEFAULT_POW_TARGET = 30;

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.getalby.com/v1',
  'wss://eu.purplerelay.com',
  'wss://nostr.einundzwanzig.space',
];

const NET_NAMES: Record<SwapNetwork, string> = {
  mainnet: 'mainnet',
  signet: 'signet',
  testnet: 'testnet',
  mutinynet: 'mutinynet',
};

/** Leading zero bits of sha256("electrum-" || pubkey || nonce as 32 bytes BE). */
export function offerPowBits(pubkeyHex: string, nonceHex: string | undefined): number {
  if (!nonceHex) return 0;
  const nonce = BigInt(nonceHex.startsWith('0x') ? nonceHex : '0x' + nonceHex);
  if (nonce < 0n) return 0;
  const nonceBytes = hexToBytes(nonce.toString(16).padStart(64, '0'));
  const pre = new Uint8Array([...utf8ToBytes('electrum-'), ...hexToBytes(pubkeyHex), ...nonceBytes]);
  const digest = sha256(pre);
  let bits = 0;
  for (const b of digest) {
    if (b === 0) { bits += 8; continue; }
    bits += Math.clz32(b) - 24;
    break;
  }
  return bits;
}

export function parseOffer(event: { pubkey: string; content: string; tags: string[][]; created_at: number }, network: SwapNetwork): SwapOffer | null {
  const tags = Object.fromEntries(event.tags.filter(t => t.length >= 2).map(t => [t[0], t[1]]));
  if (tags.d !== OFFER_D_TAG || tags.r !== `net:${NET_NAMES[network]}`) return null;
  if (tags.expiration && Number(tags.expiration) < Date.now() / 1000) return null;
  let c: any;
  try { c = JSON.parse(event.content); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const nums = ['percentage_fee', 'mining_fee', 'min_amount', 'max_forward_amount', 'max_reverse_amount'];
  if (nums.some(k => typeof c[k] !== 'number' || !isFinite(c[k]) || c[k] < 0)) return null;
  const relays = typeof c.relays === 'string' ? c.relays.split(',').filter(Boolean) : Array.isArray(c.relays) ? c.relays : [];
  return {
    pubkey: event.pubkey,
    percentageFee: c.percentage_fee,
    miningFee: c.mining_fee,
    minAmount: c.min_amount,
    maxForward: c.max_forward_amount,
    maxReverse: c.max_reverse_amount,
    relays: relays.filter((r: unknown) => typeof r === 'string' && r.startsWith('wss://')).slice(0, 10),
    powBits: offerPowBits(event.pubkey, c.pow_nonce),
    createdAt: event.created_at,
  };
}

export async function discoverOffers(opts: {
  network: SwapNetwork;
  relays?: string[];
  powTarget?: number;
  timeoutMs?: number;
  pool?: SimplePool;
}): Promise<SwapOffer[]> {
  const relays = opts.relays ?? DEFAULT_RELAYS;
  const pool = opts.pool ?? new SimplePool();
  const latest = new Map<string, SwapOffer>();
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { sub.close(); resolve(); }, opts.timeoutMs ?? 6000);
    const sub = pool.subscribeMany(relays, { kinds: [OFFER_KIND], '#d': [OFFER_D_TAG], limit: 200 }, {
      onevent(ev) {
        const o = parseOffer(ev, opts.network);
        if (!o) return;
        const prev = latest.get(o.pubkey);
        if (!prev || prev.createdAt < o.createdAt) latest.set(o.pubkey, o);
      },
      oneose() { clearTimeout(timer); sub.close(); resolve(); },
    });
  });
  if (!opts.pool) pool.close(relays);
  const target = opts.powTarget ?? DEFAULT_POW_TARGET;
  return [...latest.values()].filter(o => o.powBits >= target);
}

/** Lightning amount needed for `onchainSat` to land, before the claim fee. */
export function reverseQuote(o: SwapOffer, onchainSat: number): number {
  return Math.ceil((onchainSat + o.miningFee) / (1 - o.percentageFee / 100));
}

/** On-chain amount the server should lock for an invoice of `lightningSat`. */
export function reverseOnchainAmount(o: SwapOffer, lightningSat: number): number {
  return Math.floor(lightningSat * (1 - o.percentageFee / 100)) - o.miningFee;
}

export function cheapestReverse(offers: SwapOffer[], onchainSat: number): SwapOffer | null {
  const fit = offers.filter(o => {
    const ln = reverseQuote(o, onchainSat);
    return ln >= o.minAmount && ln <= o.maxReverse;
  });
  fit.sort((a, b) => reverseQuote(a, onchainSat) - reverseQuote(b, onchainSat) || b.powBits - a.powBits);
  return fit[0] ?? null;
}

/** Sends one encrypted request to a swap server and waits for its reply. */
export async function requestServer(opts: {
  server: string;
  relays: string[];
  secretKey: Uint8Array;
  method: string;
  data: Record<string, unknown>;
  timeoutMs?: number;
  pool?: SimplePool;
}): Promise<any> {
  const pool = opts.pool ?? new SimplePool();
  const ours = getPublicKey(opts.secretKey);
  const body = JSON.stringify({ ...opts.data, method: opts.method });
  const content = await nip04.encrypt(opts.secretKey, opts.server, body);
  const event = finalizeEvent({
    kind: REQUEST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', opts.server]],
    content,
  }, opts.secretKey);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { sub.close(); reject(new Error(`swap server did not answer ${opts.method}`)); }, opts.timeoutMs ?? 30000);
      const sub = pool.subscribeMany(opts.relays, { kinds: [REQUEST_KIND], '#p': [ours], authors: [opts.server], since: event.created_at - 10 }, {
        async onevent(ev) {
          let msg: any;
          try { msg = JSON.parse(await nip04.decrypt(opts.secretKey, ev.pubkey, ev.content)); } catch { return; }
          if (!msg || msg.reply_to !== event.id) return;
          clearTimeout(timer);
          sub.close();
          if (msg.error) reject(new Error(`swap server: ${msg.error}`));
          else resolve(msg);
        },
      });
      Promise.any(pool.publish(opts.relays, event)).catch(() => {
        clearTimeout(timer); sub.close(); reject(new Error('no relay accepted the request'));
      });
    });
  } finally {
    if (!opts.pool) pool.close(opts.relays);
  }
}

export { bytesToHex };
