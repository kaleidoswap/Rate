// utils/blossom.ts
//
// Upload an image to a Blossom media server (BUD-01 / BUD-02) so it can be
// used as the Nostr profile picture or banner. The request is authorised with
// a signed kind-24242 event; the server answers with a blob descriptor whose
// `url` is what goes into the profile.
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const BLOSSOM_SERVER = 'https://blossom.primal.net';
export const BLOSSOM_AUTH_KIND = 24242;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const AUTH_TTL_SECONDS = 10 * 60;

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent extends EventTemplate {
  id: string;
  pubkey: string;
  sig: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** The image type from its first bytes, so the upload is labelled by content, not by name. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export function serverHost(server: string): string {
  return server.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** The unsigned kind-24242 event that authorises one upload of `hash`. */
export function buildUploadAuth(hash: string, name: string, nowSeconds: number): EventTemplate {
  return {
    kind: BLOSSOM_AUTH_KIND,
    created_at: nowSeconds,
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(nowSeconds + AUTH_TTL_SECONDS)],
    ],
    content: `Upload ${name}`,
  };
}

export function authorizationHeader(event: SignedEvent): string {
  return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`;
}

/** The public URL from a blob descriptor, checked against the uploaded hash. */
export function parseBlobDescriptor(body: unknown, expectedHash: string): string {
  const d = body as { url?: unknown; sha256?: unknown } | null;
  const url = typeof d?.url === 'string' ? d.url.trim() : '';
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('The media server did not return a link');
  if (typeof d?.sha256 === 'string' && d.sha256.toLowerCase() !== expectedHash) {
    throw new Error('The media server returned a different file');
  }
  return url;
}

export interface UploadParams {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
  sign: (template: EventTemplate) => SignedEvent | Promise<SignedEvent>;
  server?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function uploadToBlossom({
  bytes,
  mimeType,
  name,
  sign,
  server = BLOSSOM_SERVER,
  fetchImpl = fetch,
  now = () => Math.floor(Date.now() / 1000),
}: UploadParams): Promise<string> {
  if (bytes.length === 0) throw new Error('The image is empty');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('The image is too large (max 8 MB)');

  const hash = sha256Hex(bytes);
  const auth = await sign(buildUploadAuth(hash, name, now()));

  let res: Response;
  try {
    res = await fetchImpl(`${server.replace(/\/+$/, '')}/upload`, {
      method: 'PUT',
      headers: {
        Authorization: authorizationHeader(auth),
        'Content-Type': mimeType,
        'X-SHA-256': hash,
      },
      body: bytes as any,
    });
  } catch {
    throw new Error(`Couldn't reach ${serverHost(server)}`);
  }

  if (!res.ok) {
    const reason = res.headers?.get?.('X-Reason');
    throw new Error(reason ? `${serverHost(server)}: ${reason}` : `${serverHost(server)} refused the upload (${res.status})`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('The media server did not return a link');
  }
  return parseBlobDescriptor(body, hash);
}
