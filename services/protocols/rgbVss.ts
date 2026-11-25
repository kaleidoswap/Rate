import { rgbWithTimeout } from './rgbTimeout';
/**
 * Minimal VSS client (LDK Versioned Storage Service) for RGB backups
 * -----------------------------------------------------------------
 * Uploads rgb-lib's encrypted backup file so RGB on this phone survives losing
 * the phone. Speaks the VSS HTTP API (`/putObjects`, `/getObject`, protobuf
 * bodies) with the "sigs" authorization LDK's vss-client uses: the request
 * proves knowledge of a key derived from the seed, and the server keeps each
 * key's data apart.
 *
 * The file is already encrypted by rgb-lib (password derived from the seed), so
 * values are stored as-is, split in chunks with a manifest written last.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

/** Same derivation as the other KaleidoSwap wallets, so one seed is one VSS identity. */
const VSS_SIGNING_PATH = "m/44'/1237'/1'/0/0";
/** LDK vss-client's SigsAuthProvider constant (64 bytes). */
const SIGNING_CONSTANT = utf8ToBytes('VSS Signature Authorizer Signing Salt Constant..................');
export const VSS_CHUNK_SIZE = 1024 * 1024;

const keyCache = new Map<string, Uint8Array>();

/** The seed's VSS signing key (cached: deriving the BIP-39 seed is slow on the JS thread). */
export function vssSigningKey(mnemonic: string): Uint8Array {
  const id = bytesToHex(sha256(utf8ToBytes(mnemonic.trim())));
  let key = keyCache.get(id);
  if (!key) {
    const child = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic.trim())).derive(VSS_SIGNING_PATH);
    if (!child.privateKey) throw new Error('Could not derive the backup key.');
    key = child.privateKey;
    keyCache.set(id, key);
  }
  return key;
}

/** `Authorization` header value: pubkey hex + compact signature hex + unix seconds. */
export function vssAuthToken(privateKey: Uint8Array, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const pubkey = secp256k1.getPublicKey(privateKey, true);
  const time = utf8ToBytes(String(nowSeconds));
  const msg = new Uint8Array(SIGNING_CONSTANT.length + pubkey.length + time.length);
  msg.set(SIGNING_CONSTANT, 0);
  msg.set(pubkey, SIGNING_CONSTANT.length);
  msg.set(time, SIGNING_CONSTANT.length + pubkey.length);
  const sig = secp256k1.sign(sha256(msg), privateKey);
  return `${bytesToHex(pubkey)}${bytesToHex(sig.toCompactRawBytes())}${nowSeconds}`;
}

// ── protobuf, just the messages used here ────────────────────────────────────
// Built from Uint8Array parts (never spread): a chunk is a megabyte.

function varint(value: bigint): Uint8Array {
  // int64 on the wire: negative numbers are their 64-bit two's complement.
  let v = value < 0n ? (1n << 64n) + value : value;
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return new Uint8Array(out);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const tag = (field: number, wire: number) => varint(BigInt((field << 3) | wire));
const bytesField = (field: number, data: Uint8Array) => concat([tag(field, 2), varint(BigInt(data.length)), data]);
const stringField = (field: number, s: string) => bytesField(field, utf8ToBytes(s));
const intField = (field: number, n: number) => concat([tag(field, 0), varint(BigInt(n))]);

export interface VssItem { key: string; value: Uint8Array; version?: number }

/** PutObjectRequest { store_id = 1; transaction_items = 3 [KeyValue { key = 1; version = 2; value = 3 }] }. */
export function encodePutObjects(storeId: string, items: VssItem[]): Uint8Array {
  // Immutable objects use unconditional writes. Manifest pointers use an expected version.
  return concat([
    stringField(1, storeId),
    ...items.map((item) => bytesField(3, concat([stringField(1, item.key), intField(2, item.version ?? -1), bytesField(3, item.value)]))),
  ]);
}

/** GetObjectRequest { store_id = 1; key = 2 }. */
export function encodeGetObject(storeId: string, key: string): Uint8Array {
  return concat([stringField(1, storeId), stringField(2, key)]);
}

interface VssObject {
  value: Uint8Array;
  version: number;
}

function decodeVersionedObject(body: Uint8Array): VssObject | undefined {
  const kv = readFields(body).bytes.get(2);
  if (!kv) return undefined;
  const fields = readFields(kv);
  const value = fields.bytes.get(3);
  const version = Number(fields.integers.get(2) ?? 0n);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Unexpected VSS object version.');
  return value ? { value, version } : undefined;
}

/** GetObjectResponse { value = 2: KeyValue } → the value bytes (undefined when absent). */
export function decodeGetObject(body: Uint8Array): Uint8Array | undefined {
  return decodeVersionedObject(body)?.value;
}

function readFields(buf: Uint8Array) {
  const bytes = new Map<number, Uint8Array>();
  const integers = new Map<number, bigint>();
  let at = 0;
  const readVarint = () => {
    let result = 0n;
    for (let shift = 0n; shift < 64n && at < buf.length; shift += 7n) {
      const byte = buf[at++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
    }
    throw new Error('Unexpected VSS response.');
  };
  while (at < buf.length) {
    const key = Number(readVarint());
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) {
      integers.set(field, readVarint());
      continue;
    }
    if (wire !== 2) throw new Error('Unexpected VSS response.');
    const length = Number(readVarint());
    if (!Number.isSafeInteger(length) || length > buf.length - at) throw new Error('Unexpected VSS response.');
    bytes.set(field, buf.subarray(at, at + length));
    at += length;
  }
  return { bytes, integers };
}

// ── client ───────────────────────────────────────────────────────────────────

export interface VssClient {
  put(items: VssItem[]): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  getVersioned(key: string): Promise<VssObject | undefined>;
}

export function createVssClient(serverUrl: string, storeId: string, signingKey: Uint8Array, fetchImpl: typeof fetch = fetch): VssClient {
  const base = serverUrl.replace(/\/+$/, '');
  const call = async (path: string, body: Uint8Array) => {
    const controller = new AbortController();
    return rgbWithTimeout((async () => {
    const res = await fetchImpl(`${base}/${path}`, {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: vssAuthToken(signingKey) },
      body: body as any,
    });
    if (res.status === 404 && path === 'getObject') return undefined;
    if (res.status === 409 && path === 'putObjects') throw new Error(RGB_BACKUP_CONFLICT);
    if (!res.ok) throw new Error(`Backup server error (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
    })(), 30_000, 'The RGB backup server did not respond within 30 seconds. Check your connection and try again.', () => controller.abort());
  };
  const getVersioned = async (key: string) => {
    const body = await call('getObject', encodeGetObject(storeId, key));
    return body ? decodeVersionedObject(body) : undefined;
  };
  return {
    async put(items) { await call('putObjects', encodePutObjects(storeId, items)); },
    async get(key) { return (await getVersioned(key))?.value; },
    getVersioned,
  };
}

export interface BackupManifest {
  version: 1 | 2;
  size: number;
  chunks: number;
  sha256: string;
  createdAt: number;
  /** The legacy pointer last observed when establishing the versioned pointer. */
  legacySha256?: string | null;
}

export const RGB_BACKUP_LEGACY_CONFLICT = 'An older version of Rate changed the cloud backup on another device. Keep both wallets and export encrypted copies before restoring.';
export class RgbBackupLegacyConflict extends Error {
  constructor() {
    super(RGB_BACKUP_LEGACY_CONFLICT);
    this.name = 'RgbBackupLegacyConflict';
  }
}
export const RGB_BACKUP_CONFLICT = 'Another device changed this RGB backup. Keep an encrypted copy of this wallet before restoring from the cloud.';

export interface VersionedBackupManifest {
  manifest: BackupManifest;
  objectVersion: number;
  /** Only the new pointer is authoritative once it exists. */
  legacy?: boolean;
}

interface UploadPlan {
  previous: VersionedBackupManifest | null;
  recordCandidate(manifest: BackupManifest): Promise<void>;
}

/** Immutable snapshots are retained even when a concurrent upload wins the pointer update. */
export async function uploadBackupFile(
  client: VssClient,
  prefix: string,
  data: Uint8Array,
  now = Date.now(),
  plan?: UploadPlan,
): Promise<BackupManifest> {
  const previous = plan ? plan.previous : await readVersionedBackupManifest(client, prefix);
  const digest = bytesToHex(sha256(data));
  const chunks = Math.max(1, Math.ceil(data.length / VSS_CHUNK_SIZE));
  const legacySha256 = previous?.legacy ? previous.manifest.sha256 : previous?.manifest.legacySha256 ?? null;
  const manifest: BackupManifest = { version: 2, size: data.length, chunks, sha256: digest, createdAt: now, legacySha256 };
  await retainSnapshot(client, prefix, manifest, data);
  if (previous && previous.manifest.sha256 !== digest) {
    // Retain the previous snapshot even if it was written by an older release.
    const earlier = previous.manifest;
    const key = `${prefix}/versions/${earlier.sha256}/manifest`;
    if (!(await client.get(key))) {
      if (earlier.version === 1) {
        await retainSnapshot(client, prefix, { ...earlier, version: 2 }, await readSnapshot(client, prefix, earlier));
      } else {
        await client.put([{ key, value: encodeManifest(earlier) }]);
      }
    }
  }
  await checkLegacyPointer(client, prefix, legacySha256);
  await plan?.recordCandidate(manifest);
  await client.put([{ key: `${prefix}/current`, value: encodeManifest(manifest), version: previous?.objectVersion ?? 0 }]);
  return manifest;
}

const encodeManifest = (manifest: BackupManifest) => utf8ToBytes(JSON.stringify(manifest));

async function retainSnapshot(client: VssClient, prefix: string, manifest: BackupManifest, data: Uint8Array): Promise<void> {
  const versionPrefix = `${prefix}/versions/${manifest.sha256}`;
  for (let i = 0; i < manifest.chunks; i++) {
    await client.put([{ key: `${versionPrefix}/chunk/${i}`, value: data.slice(i * VSS_CHUNK_SIZE, (i + 1) * VSS_CHUNK_SIZE) }]);
  }
  await client.put([{ key: `${versionPrefix}/manifest`, value: encodeManifest(manifest) }]);
}

async function readLegacyManifest(client: VssClient, prefix: string): Promise<BackupManifest | undefined> {
  const raw = await client.get(`${prefix}/manifest`);
  return raw ? parseManifest(raw) : undefined;
}

async function checkLegacyPointer(client: VssClient, prefix: string, expected: string | null): Promise<void> {
  const legacy = await readLegacyManifest(client, prefix);
  if ((legacy?.sha256 ?? null) !== expected) throw new RgbBackupLegacyConflict();
}

export async function readVersionedBackupManifest(client: VssClient, prefix: string): Promise<VersionedBackupManifest | null> {
  const current = await client.getVersioned(`${prefix}/current`);
  if (current) {
    const manifest = parseManifest(current.value);
    await checkLegacyPointer(client, prefix, manifest.legacySha256 ?? null);
    return { manifest, objectVersion: current.version };
  }
  const legacy = await readLegacyManifest(client, prefix);
  return legacy ? { manifest: legacy, objectVersion: 0, legacy: true } : null;
}

/** Older releases only read and write /manifest. Both generations remain available if they diverge. */
export async function readBackupManifest(client: VssClient, prefix: string): Promise<BackupManifest | undefined> {
  return (await readVersionedBackupManifest(client, prefix))?.manifest;
}

function parseManifest(raw: Uint8Array): BackupManifest {
  // Server bytes are untrusted: malformed JSON and non-objects read as the
  // one guarded refusal, never as a raw SyntaxError/TypeError in restore UX.
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error('Unsupported RGB backup.');
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('Unsupported RGB backup.');
  const manifest = parsed as BackupManifest;
  if (![1, 2].includes(manifest.version) || !Number.isSafeInteger(manifest.size) || manifest.size < 0 || !Number.isSafeInteger(manifest.createdAt) || manifest.createdAt < 0 || !Number.isInteger(manifest.chunks) || manifest.chunks !== Math.max(1, Math.ceil(manifest.size / VSS_CHUNK_SIZE)) || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || (manifest.legacySha256 != null && !/^[a-f0-9]{64}$/.test(manifest.legacySha256))) throw new Error('Unsupported RGB backup.');
  return manifest;
}

export async function downloadBackupFile(client: VssClient, prefix: string): Promise<{ data: Uint8Array; manifest: BackupManifest } | undefined> {
  const manifest = await readBackupManifest(client, prefix);
  if (!manifest) return undefined;
  const data = await readSnapshot(client, prefix, manifest);
  // The chunks can take time to download. Refuse a snapshot that stopped being current.
  const latest = await readBackupManifest(client, prefix);
  if (latest?.sha256 !== manifest.sha256) throw new Error('The RGB backup changed while downloading. Try restoring it again.');
  return { data, manifest };
}

async function readSnapshot(client: VssClient, prefix: string, manifest: BackupManifest): Promise<Uint8Array> {
  const data = new Uint8Array(manifest.size);
  let at = 0;
  for (let i = 0; i < manifest.chunks; i++) {
    const chunkPrefix = manifest.version === 2 ? `${prefix}/versions/${manifest.sha256}` : prefix;
    const chunk = await client.get(`${chunkPrefix}/chunk/${i}`);
    if (!chunk || at + chunk.length > manifest.size) throw new Error('The RGB backup is incomplete.');
    data.set(chunk, at);
    at += chunk.length;
  }
  if (at !== manifest.size || bytesToHex(sha256(data)) !== manifest.sha256) throw new Error('The RGB backup is damaged.');
  return data;
}
