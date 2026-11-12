/**
 * Property tests for the RGB VSS backup — the wallet-recovery path.
 *
 * The example-based suite next to this file pins the concrete cases; these
 * pin the laws: every backup round-trips, an interrupted upload never
 * corrupts the published one, and nothing a hostile server says is ever
 * read as backup data without the manifest check.
 */
import fc from 'fast-check';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  VSS_CHUNK_SIZE,
  decodeGetObject,
  downloadBackupFile,
  readBackupManifest,
  uploadBackupFile,
  vssAuthToken,
  vssSigningKey,
  type VssClient,
} from './rgbVss';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SIGNING_CONSTANT = utf8ToBytes('VSS Signature Authorizer Signing Salt Constant..................');

function memoryStore(): { store: Map<string, Uint8Array>; client: VssClient } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    client: {
      async put(items) { for (const item of items) store.set(item.key, item.value); },
      async get(key) { return store.get(key); },
    },
  };
}

const patterned = (size: number, seed: number) =>
  new Uint8Array(size).map((_, i) => (i * 31 + seed) % 251);

test('every backup round-trips byte-identically, at any size across the chunk boundary', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: 2 * VSS_CHUNK_SIZE + 17 }),
      fc.integer({ min: 0, max: 255 }),
      async (size, seed) => {
        const { client } = memoryStore();
        const data = patterned(size, seed);
        const manifest = await uploadBackupFile(client, 'backup', data, 42);
        expect(manifest.size).toBe(size);
        expect(manifest.chunks).toBe(Math.max(1, Math.ceil(size / VSS_CHUNK_SIZE)));
        expect(manifest.sha256).toBe(bytesToHex(sha256(data)));
        const got = await downloadBackupFile(client, 'backup');
        expect(got).toBeDefined();
        expect(Buffer.from(got!.data).equals(Buffer.from(data))).toBe(true);
        expect(got!.manifest).toEqual(manifest);
      },
    ),
    { numRuns: 20 },
  );
});

test('an upload interrupted at any point leaves the published backup readable', async () => {
  await fc.assert(
    fc.asyncProperty(
      // 0..4 puts into the second upload: 0 = first chunk, 2 = the manifest
      // write itself, 4 = the whole upload (which must then succeed).
      fc.integer({ min: 0, max: 4 }),
      fc.integer({ min: 0, max: 255 }),
      async (failAfter, seed) => {
        const store = new Map<string, Uint8Array>();
        let failAfterPuts = Number.POSITIVE_INFINITY;
        let puts = 0;
        const client: VssClient = {
          async put(items) {
            if (puts++ >= failAfterPuts) throw new Error('offline');
            for (const item of items) store.set(item.key, item.value);
          },
          async get(key) { return store.get(key); },
        };
        const original = patterned(VSS_CHUNK_SIZE + 1, seed);
        await uploadBackupFile(client, 'backup', original, 1);

        puts = 0;
        failAfterPuts = failAfter;
        const replacement = patterned(VSS_CHUNK_SIZE + 1, seed ^ 0x5a);
        let uploaded = true;
        try {
          await uploadBackupFile(client, 'backup', replacement, 2);
        } catch {
          uploaded = false;
        }
        // Whatever happened, a readable backup exists — and until the whole
        // replacement landed, it is the original, never a torn mix.
        const got = await downloadBackupFile(client, 'backup');
        expect(got).toBeDefined();
        const expected = uploaded ? replacement : original;
        expect(Buffer.from(got!.data).equals(Buffer.from(expected))).toBe(true);
      },
    ),
    { numRuns: 20 },
  );
});

test('a hostile manifest is refused with the guarded error, never parsed as a backup', async () => {
  await fc.assert(
    fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (raw) => {
      const client: VssClient = {
        put: async () => {},
        get: async (key) => (key.endsWith('/manifest') ? raw : undefined),
      };
      try {
        const manifest = await readBackupManifest(client, 'backup');
        // Anything accepted must satisfy every rule the download relies on.
        expect(manifest).toBeDefined();
        expect([1, 2]).toContain(manifest!.version);
        expect(Number.isSafeInteger(manifest!.size) && manifest!.size >= 0).toBe(true);
        expect(manifest!.chunks).toBe(Math.max(1, Math.ceil(manifest!.size / VSS_CHUNK_SIZE)));
        expect(manifest!.sha256).toMatch(/^[a-f0-9]{64}$/);
      } catch (e: unknown) {
        // Malformed JSON, non-objects and failed checks all read as the one
        // guarded refusal — a raw SyntaxError/TypeError would leak server
        // noise into restore UX and is a bug.
        expect((e as Error).message).toBe('Unsupported RGB backup.');
      }
    }),
    { numRuns: 100 },
  );
});

test('a hostile getObject response never hangs or crashes the reader', () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 256 }), (body) => {
      try {
        const value = decodeGetObject(body);
        if (value !== undefined) expect(value).toBeInstanceOf(Uint8Array);
      } catch (e: unknown) {
        expect((e as Error).message).toBe('Unexpected VSS response.');
      }
    }),
    { numRuns: 500 },
  );
});

test('every auth token verifies against its own key and timestamp', () => {
  const key = vssSigningKey(MNEMONIC);
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 2 ** 32 }), (seconds) => {
      const token = vssAuthToken(key, seconds);
      const pubkey = token.slice(0, 66);
      const sig = token.slice(66, 194);
      const time = token.slice(194);
      expect(time).toBe(String(seconds));
      expect(pubkey).toBe(bytesToHex(secp256k1.getPublicKey(key, true)));
      const message = new Uint8Array([...SIGNING_CONSTANT, ...hexToBytes(pubkey), ...utf8ToBytes(time)]);
      expect(secp256k1.verify(hexToBytes(sig), sha256(message), hexToBytes(pubkey))).toBe(true);
    }),
    { numRuns: 50 },
  );
  // One seed is one VSS identity: whitespace around the mnemonic cannot
  // fork the backup key.
  expect(vssSigningKey(`  ${MNEMONIC}  `)).toEqual(key);
  expect(vssSigningKey(`${MNEMONIC}\n`)).toEqual(key);
});
