import type { RgbMethod } from '@utexo/webrgb';
import type { WebRgbBackend } from './provider';

export const NWA_SESSION_SECONDS = 3600;
const PUBLIC_KEY = /^[0-9a-f]{64}$/;
const NONCE = /^(?:[0-9a-f]{2}){16,64}$/;
export const unixTime = () => Math.floor(Date.now() / 1000);

export function methodName(method: RgbMethod): string {
  return 'kaleido_' + method.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

export function displayName(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, 80);
}

export interface Authorization {
  client: string;
  state: string;
  name: string;
  methods: string[];
  relays: string[];
  expires: number;
  challenge?: string;
}

export function parseAuthorization(uri: string, network: string, supported: RgbMethod[]): Authorization {
  const bad = () => new Error('Scan a fresh Nostr Wallet Auth QR from the RGB app.');
  if (uri.length > 4096 || !/^nostr\+walletauth(?:\+kaleidoswap)?:\/\//i.test(uri)) throw bad();
  let url: URL;
  try { url = new URL(uri); } catch { throw bad(); }
  if (url.username || url.password || url.port || url.pathname || url.hash || !PUBLIC_KEY.test(url.hostname)) throw bad();
  const query = url.searchParams;
  for (const key of new Set(query.keys())) if (key !== 'relay' && query.getAll(key).length !== 1) throw bad();
  for (const key of ['max_amount', 'renewal_period', 'isolated', 'notification_types', 'secret']) {
    if (query.has(key)) throw new Error('This RGB connection cannot grant the requested settings or spending allowance.');
  }
  const state = query.get('state') ?? '';
  if (!NONCE.test(state)) throw bad();
  const relays = [...new Set(query.getAll('relay'))];
  if (!relays.length || relays.length > 3) throw bad();
  for (const raw of relays) {
    let relay: URL;
    try { relay = new URL(raw); } catch { throw bad(); }
    if (raw.length > 256 || relay.protocol !== 'wss:' || relay.username || relay.password || relay.search || relay.hash || !relay.hostname) throw bad();
  }
  let metadata: Record<string, unknown>;
  try { metadata = JSON.parse(query.get('metadata') ?? '{}'); } catch { throw bad(); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw bad();
  if (metadata.network !== undefined && metadata.network !== network) throw new Error('Switch the on-device RGB wallet to the network requested by the app.');
  const challenge = metadata.challenge;
  if (challenge !== undefined && (typeof challenge !== 'string' || !NONCE.test(challenge))) throw bad();
  const now = unixTime();
  const expires = query.has('expires_at') ? Number(query.get('expires_at')) : now + NWA_SESSION_SECONDS;
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + NWA_SESSION_SECONDS + 30) throw new Error('Scan a new authorization that expires within one hour.');
  const split = (key: string) => (query.get(key) ?? '').split(/\s+/).filter(Boolean);
  const required = split('request_methods');
  const supportedNames = new Set(['get_info', ...supported.map(methodName)]);
  if (required.some(name => !supportedNames.has(name))) throw new Error('This wallet does not support all required methods.');
  const methods = [...new Set([...required, ...split('optional_request_methods').filter(name => supportedNames.has(name))])];
  if (!methods.length) throw new Error('This QR requests no supported RGB permissions.');
  return { client: url.hostname, state, name: displayName(query.get('name') ?? '') || 'NWC app', methods, relays, expires,
    ...(typeof challenge === 'string' ? { challenge } : {}) };
}

const argumentCounts: Partial<Record<RgbMethod, [min: number, max: number]>> = {
  enable: [0, 0], getInfo: [0, 0], getAddress: [0, 0], getBtcBalance: [0, 0], listAssets: [0, 0],
  getAssetBalance: [1, 1], blindReceive: [0, 1], witnessReceive: [0, 1], sendAsset: [1, 1],
  decodeRgbInvoice: [1, 1], listTransfers: [0, 1], getTransferStatus: [1, 2], refresh: [0, 1],
  createUtxos: [0, 1], signMessage: [1, 1], getReceivedMint: [1, 1],
};
export const mutatesWallet = (method: RgbMethod) => ['blindReceive', 'witnessReceive', 'sendAsset', 'createUtxos', 'refresh', 'signMessage'].includes(method);

export async function invoke(backend: WebRgbBackend, method: RgbMethod, params: Record<string, unknown>) {
  const range = argumentCounts[method];
  const args = params.args;
  if (Object.keys(params).length !== 1 || !Array.isArray(args) || !range || args.length < range[0] || args.length > range[1]) {
    throw Object.assign(new Error('Invalid WebRGB method arguments.'), { code: 'INVALID_PARAMS' });
  }
  const fn: unknown = backend[method as keyof WebRgbBackend];
  if (typeof fn !== 'function') throw Object.assign(new Error('Unsupported RGB method.'), { code: 'METHOD_NOT_SUPPORTED' });
  return { value: (await Reflect.apply(fn, backend, args)) ?? null };
}
