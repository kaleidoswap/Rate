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
  // version -1: write regardless of the stored version (each upload replaces the last).
  return concat([
    stringField(1, storeId),
    ...items.map((item) => bytesField(3, concat([stringField(1, item.key), intField(2, item.version ?? -1), bytesField(3, item.value)]))),
  ]);
}

/** GetObjectRequest { store_id = 1; key = 2 }. */
export function encodeGetObject(storeId: string, key: string): Uint8Array {
  return concat([stringField(1, storeId), stringField(2, key)]);
}

/** GetObjectResponse { value = 2: KeyValue } → the value bytes (undefined when absent). */
export function decodeGetObject(body: Uint8Array): Uint8Array | undefined {
  const fields = readFields(body);
  const kv = fields.get(2);
  return kv ? readFields(kv).get(3) : undefined;
}

function readFields(buf: Uint8Array): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  let i = 0;
  const readVarint = () => {
    let result = 0n, shift = 0n;
    for (;;) {
      const b = buf[i++];
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const key = Number(readVarint());
    const field = key >> 3, wire = key & 7;
    if (wire === 0) { readVarint(); continue; }
    if (wire !== 2) throw new Error('Unexpected VSS response.');
    const len = Number(readVarint());
    out.set(field, buf.slice(i, i + len));
    i += len;
  }
  return out;
}

// ── client ───────────────────────────────────────────────────────────────────

export interface VssClient {
  put(items: VssItem[]): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
}

export function createVssClient(serverUrl: string, storeId: string, signingKey: Uint8Array, fetchImpl: typeof fetch = fetch): VssClient {
  const base = serverUrl.replace(/\/+$/, '');
  const call = async (path: string, body: Uint8Array) => {
    const res = await fetchImpl(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: vssAuthToken(signingKey) },
      body: body as any,
    });
    if (res.status === 404 && path === 'getObject') return undefined;
    if (!res.ok) throw new Error(`Backup server error (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return {
    async put(items) { await call('putObjects', encodePutObjects(storeId, items)); },
    async get(key) {
      const body = await call('getObject', encodeGetObject(storeId, key));
      return body ? decodeGetObject(body) : undefined;
    },
  };
}

export interface BackupManifest { version: 1; size: number; chunks: number; sha256: string; createdAt: number }

/** Chunks first, manifest last: a reader never sees a manifest whose chunks aren't there yet. */
export async function uploadBackupFile(client: VssClient, prefix: string, data: Uint8Array, now = Date.now()): Promise<BackupManifest> {
  const chunks = Math.max(1, Math.ceil(data.length / VSS_CHUNK_SIZE));
  for (let i = 0; i < chunks; i++) {
    await client.put([{ key: `${prefix}/chunk/${i}`, value: data.slice(i * VSS_CHUNK_SIZE, (i + 1) * VSS_CHUNK_SIZE) }]);
  }
  const manifest: BackupManifest = { version: 1, size: data.length, chunks, sha256: bytesToHex(sha256(data)), createdAt: now };
  await client.put([{ key: `${prefix}/manifest`, value: utf8ToBytes(JSON.stringify(manifest)) }]);
  return manifest;
}

/**
 * The last uploaded file, checked against its manifest; undefined when this
 * store has none. Network and server errors throw: "no backup" must never be
 * guessed, or a fresh wallet would start and back up over the real one.
 */
export async function downloadBackupFile(client: VssClient, prefix: string): Promise<{ data: Uint8Array; manifest: BackupManifest } | undefined> {
  const raw = await client.get(`${prefix}/manifest`);
  if (!raw) return undefined;
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as BackupManifest;
  if (manifest.version !== 1 || !Number.isInteger(manifest.chunks) || manifest.chunks < 1) throw new Error('Unsupported RGB backup.');
  const data = new Uint8Array(manifest.size);
  let at = 0;
  for (let i = 0; i < manifest.chunks; i++) {
    const chunk = await client.get(`${prefix}/chunk/${i}`);
    if (!chunk || at + chunk.length > manifest.size) throw new Error('The RGB backup is incomplete.');
    data.set(chunk, at);
    at += chunk.length;
  }
  if (at !== manifest.size || bytesToHex(sha256(data)) !== manifest.sha256) throw new Error('The RGB backup is damaged.');
  return { data, manifest };
}
