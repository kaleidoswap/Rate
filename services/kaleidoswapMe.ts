// services/kaleidoswapMe.ts
//
// Client for the kaleidoswap.me Lightning Address registry (same API and signed
// messages as the Rate extension). A handle `name@kaleidoswap.me` points at this
// wallet's Spark address; payments land in Spark even when the app is closed.
// Every change is signed with the Spark identity key; nothing secret leaves the
// device. The claimed handle is remembered per wallet (it is public, so the plain
// settings table is fine).
//
// Payment pushes: the app registers its Expo push token against the handle, and
// the registry's minter sends a push when an invoice for the handle is paid.
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import DatabaseService from './DatabaseService';
import { protocolManager } from './protocols';

export const KALEIDOSWAP_ME_BASE_URL = 'https://kaleidoswap.me';
export const KALEIDOSWAP_ME_DOMAIN = 'kaleidoswap.me';

export interface StoredHandle {
  name: string;
  lightningAddress: string;
  sparkAddress: string;
  claimedAt: number;
}

export interface Availability {
  available: boolean;
  valid: boolean;
  error?: string;
}

type Fetch = typeof fetch;

/** The Spark wallet calls the registry needs (SparkWallet from @buildonspark/spark-sdk). */
export interface SparkSigner {
  getSparkAddress(): Promise<string>;
  getIdentityPublicKey(): Promise<string>;
  signMessageWithIdentityKey(message: string, compact?: boolean): Promise<string>;
}

// Same rule as the registry: 5-32 chars, a-z 0-9 . _ -, not starting or ending with a separator.
const NAME_RE = /^[a-z0-9][a-z0-9._-]{3,30}[a-z0-9]$/;

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/@kaleidoswap\.me$/, '');
}

/** Why a name can't be used, checked before asking the registry; null when it looks fine. */
export function nameProblem(raw: string): string | null {
  const name = normalizeName(raw);
  if (!name) return null;
  if (name.length < 5) return 'At least 5 characters.';
  if (name.length > 32) return 'At most 32 characters.';
  if (!NAME_RE.test(name)) return 'Use a-z, 0-9 and . _ - (not at the start or end).';
  return null;
}

const storageKey = (walletId: number) => `kaleidoswap-me-handle-v1-${walletId}`;

export function isStoredHandle(value: unknown): value is StoredHandle {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredHandle>;
  return typeof v.name === 'string' && typeof v.lightningAddress === 'string' && typeof v.sparkAddress === 'string' && typeof v.claimedAt === 'number';
}

export async function getStoredHandle(walletId: number): Promise<StoredHandle | null> {
  try {
    const raw = await DatabaseService.getInstance().getSetting(storageKey(walletId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isStoredHandle(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function storeHandle(walletId: number, handle: StoredHandle | null): Promise<void> {
  await DatabaseService.getInstance().setSetting(storageKey(walletId), handle ? JSON.stringify(handle) : '');
}

/** The connected mainnet Spark wallet, or an error saying what is missing. */
export function sparkSigner(): SparkSigner {
  let adapter: any;
  try { adapter = protocolManager.getAdapterIfAvailable('SPARK'); } catch { adapter = undefined; }
  if (!adapter?.isConnected?.()) throw new Error('Connect your Spark account first.');
  if (adapter.network && adapter.network !== 'mainnet') throw new Error('kaleidoswap.me works with Spark on mainnet.');
  const wallet = adapter.account?._wallet;
  if (!wallet?.signMessageWithIdentityKey || !wallet.getIdentityPublicKey || !wallet.getSparkAddress) {
    throw new Error('This Spark wallet cannot sign. Update the app.');
  }
  return wallet as SparkSigner;
}

async function readJson(res: Response): Promise<any> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return {};
  try { return await res.json(); } catch { return {}; }
}

/** Plain-language versions of the registry's errors. */
function friendly(error: string | undefined, status: number): string {
  if (!error) return status === 429 ? 'Too many attempts. Wait a minute and try again.' : `kaleidoswap.me answered ${status}. Try again.`;
  if (/already taken/i.test(error)) return 'That name is taken.';
  if (/already has a claimed name/i.test(error)) return 'This wallet already has a name. Release it first.';
  if (/reserved/i.test(error)) return 'That name is reserved.';
  if (/rate limit/i.test(error)) return 'Too many attempts. Wait a minute and try again.';
  if (/timestamp/i.test(error)) return "Your phone's clock looks wrong. Check the date and time, then try again.";
  return error;
}

export async function checkName(raw: string, fetchImpl: Fetch = fetch): Promise<Availability> {
  const name = normalizeName(raw);
  const problem = nameProblem(name);
  if (problem) return { available: false, valid: false, error: problem };
  try {
    const res = await fetchImpl(`${KALEIDOSWAP_ME_BASE_URL}/v1/names/${encodeURIComponent(name)}`);
    const json = await readJson(res);
    if (!res.ok && res.status !== 400) return { available: false, valid: false, error: friendly(json.error, res.status) };
    return { available: !!json.available, valid: json.valid !== false, error: json.error ? friendly(json.error, res.status) : undefined };
  } catch {
    return { available: false, valid: false, error: "Can't reach kaleidoswap.me. Check your connection." };
  }
}

export async function claimHandle(walletId: number, raw: string, opts: { nostrPubkey?: string; signer?: SparkSigner; fetchImpl?: Fetch } = {}): Promise<StoredHandle> {
  const signer = opts.signer ?? sparkSigner();
  const doFetch = opts.fetchImpl ?? fetch;
  const name = normalizeName(raw);
  const problem = nameProblem(name);
  if (problem) throw new Error(problem);
  const sparkAddress = await signer.getSparkAddress();
  const identityPubkey = await signer.getIdentityPublicKey();
  const timestamp = Date.now();
  const signature = await signer.signMessageWithIdentityKey(`kaleidoswap-me:register:${name}:${sparkAddress}:${timestamp}`);
  const res = await doFetch(`${KALEIDOSWAP_ME_BASE_URL}/v1/names`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, sparkAddress, identityPubkey, nostrPubkey: opts.nostrPubkey, timestamp, signature }),
  });
  const json = await readJson(res);
  if (!res.ok || !json.ok || !json.lightningAddress) throw new Error(friendly(json.error, res.status));
  const handle: StoredHandle = { name, lightningAddress: json.lightningAddress, sparkAddress, claimedAt: timestamp };
  await storeHandle(walletId, handle);
  return handle;
}

/** Gives the name back so this wallet can claim another. Stops its payment pushes too. */
export async function releaseHandle(walletId: number, opts: { signer?: SparkSigner; fetchImpl?: Fetch } = {}): Promise<void> {
  const stored = await getStoredHandle(walletId);
  if (!stored) throw new Error('No name to release.');
  const signer = opts.signer ?? sparkSigner();
  const doFetch = opts.fetchImpl ?? fetch;
  const identityPubkey = await signer.getIdentityPublicKey();
  const timestamp = Date.now();
  // The registry signs over the address it has on file, not the current one.
  const signature = await signer.signMessageWithIdentityKey(`kaleidoswap-me:release:${stored.name}:${stored.sparkAddress}:${timestamp}`);
  const res = await doFetch(`${KALEIDOSWAP_ME_BASE_URL}/v1/names/${encodeURIComponent(stored.name)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identityPubkey, timestamp, signature }),
  });
  const json = await readJson(res);
  if (!res.ok || !json.ok) throw new Error(friendly(json.error, res.status));
  await storeHandle(walletId, null);
}

/** Points the name at this wallet's current Spark address, when it changed. */
export async function refreshTarget(walletId: number, opts: { signer?: SparkSigner; fetchImpl?: Fetch } = {}): Promise<boolean> {
  const stored = await getStoredHandle(walletId);
  if (!stored) return false;
  const signer = opts.signer ?? sparkSigner();
  const sparkAddress = await signer.getSparkAddress();
  if (sparkAddress === stored.sparkAddress) return false;
  const doFetch = opts.fetchImpl ?? fetch;
  const identityPubkey = await signer.getIdentityPublicKey();
  const timestamp = Date.now();
  const signature = await signer.signMessageWithIdentityKey(`kaleidoswap-me:update:${stored.name}:${sparkAddress}:${timestamp}`);
  const res = await doFetch(`${KALEIDOSWAP_ME_BASE_URL}/v1/names/${encodeURIComponent(stored.name)}/target`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: stored.name, sparkAddress, identityPubkey, timestamp, signature }),
  });
  const json = await readJson(res);
  if (!res.ok || !json.ok) throw new Error(friendly(json.error, res.status));
  await storeHandle(walletId, { ...stored, sparkAddress, claimedAt: timestamp });
  return true;
}

/**
 * After a restore: finds the name this wallet's Spark identity (or its Spark
 * address) already owns and remembers it. Null when there is none or the
 * registry can't be reached; never throws.
 */
export async function linkExistingHandle(walletId: number, opts: { signer?: SparkSigner; fetchImpl?: Fetch } = {}): Promise<StoredHandle | null> {
  try {
    const signer = opts.signer ?? sparkSigner();
    const doFetch = opts.fetchImpl ?? fetch;
    const identityPubkey = await signer.getIdentityPublicKey();
    const sparkAddress = await signer.getSparkAddress();
    for (const path of [`/v1/identity/${encodeURIComponent(identityPubkey)}`, `/v1/target/${encodeURIComponent(sparkAddress)}`]) {
      const res = await doFetch(`${KALEIDOSWAP_ME_BASE_URL}${path}`);
      if (!res.ok) continue;
      const rec = (await readJson(res)).record;
      if (!rec?.name || !rec.lightningAddress) continue;
      const handle: StoredHandle = { name: String(rec.name).toLowerCase(), lightningAddress: rec.lightningAddress, sparkAddress: rec.sparkAddress, claimedAt: Date.now() };
      await storeHandle(walletId, handle);
      return handle;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- payment pushes ---------------------------------------------------------

export function tokenHash(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

async function pushRequest(method: 'POST' | 'DELETE', action: 'push-register' | 'push-remove', handle: StoredHandle, token: string, platform: 'ios' | 'android', opts: { signer?: SparkSigner; fetchImpl?: Fetch }): Promise<void> {
  const signer = opts.signer ?? sparkSigner();
  const doFetch = opts.fetchImpl ?? fetch;
  const identityPubkey = await signer.getIdentityPublicKey();
  const timestamp = Date.now();
  const signature = await signer.signMessageWithIdentityKey(`kaleidoswap-me:${action}:${handle.name}:${tokenHash(token)}:${timestamp}`);
  const res = await doFetch(`${KALEIDOSWAP_ME_BASE_URL}/v1/names/${encodeURIComponent(handle.name)}/push`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, platform, identityPubkey, timestamp, signature }),
  });
  const json = await readJson(res);
  if (!res.ok || !json.ok) throw new Error(friendly(json.error, res.status));
}

/** Ask kaleidoswap.me to push to this device when a payment to the handle lands. */
export function registerPushDevice(handle: StoredHandle, token: string, platform: 'ios' | 'android', opts: { signer?: SparkSigner; fetchImpl?: Fetch } = {}): Promise<void> {
  return pushRequest('POST', 'push-register', handle, token, platform, opts);
}

export function removePushDevice(handle: StoredHandle, token: string, platform: 'ios' | 'android', opts: { signer?: SparkSigner; fetchImpl?: Fetch } = {}): Promise<void> {
  return pushRequest('DELETE', 'push-remove', handle, token, platform, opts);
}
