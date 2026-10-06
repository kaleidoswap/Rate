import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { VSS_CHUNK_SIZE, createVssClient, decodeGetObject, encodePutObjects, uploadBackupFile, vssAuthToken, vssSigningKey } from './rgbVss';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('the auth token is LDK vss-client’s sigs format and verifies against the seed’s key', () => {
  const key = vssSigningKey(MNEMONIC);
  const token = vssAuthToken(key, 1_700_000_000);
  const pubkey = token.slice(0, 66), sig = token.slice(66, 194), time = token.slice(194);
  expect(time).toBe('1700000000');
  expect(pubkey).toBe(Buffer.from(secp256k1.getPublicKey(key, true)).toString('hex'));
  const msg = new Uint8Array([...utf8ToBytes('VSS Signature Authorizer Signing Salt Constant..................'), ...hexToBytes(pubkey), ...utf8ToBytes(time)]);
  expect(secp256k1.verify(hexToBytes(sig), sha256(msg), hexToBytes(pubkey))).toBe(true);
  expect(vssSigningKey(MNEMONIC)).toBe(key); // cached
});

test('putObjects encodes store id and items with version -1 as int64', () => {
  const body = encodePutObjects('s', [{ key: 'k', value: new Uint8Array([1, 2]) }]);
  // field1 "s" | field3 { field1 "k", field2 varint(-1) = ten bytes, field3 [1,2] }
  expect(Array.from(body)).toEqual([
    0x0a, 1, 0x73,
    0x1a, 18, 0x0a, 1, 0x6b, 0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x1a, 2, 1, 2,
  ]);
  // GetObjectResponse { value = 2: KeyValue { value = 3 } }
  expect(Array.from(decodeGetObject(new Uint8Array([0x12, 4, 0x1a, 2, 9, 8]))!)).toEqual([9, 8]);
});

test('a backup uploads its chunks before the manifest, signed, to the store', async () => {
  const calls: { url: string; auth: string; body: Uint8Array }[] = [];
  const fetchImpl: any = async (url: string, init: any) => {
    calls.push({ url, auth: init.headers.Authorization, body: init.body });
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const client = createVssClient('https://vss.example/vss/', 'store-1', vssSigningKey(MNEMONIC), fetchImpl);
  const data = new Uint8Array(VSS_CHUNK_SIZE + 10).fill(7);
  const manifest = await uploadBackupFile(client, 'rgb-backup-file', data, 42);
  expect(manifest).toEqual(expect.objectContaining({ size: VSS_CHUNK_SIZE + 10, chunks: 2, createdAt: 42 }));
  expect(calls.map((c) => c.url)).toEqual(Array(3).fill('https://vss.example/vss/putObjects'));
  const keys = calls.map((c) => Buffer.from(c.body).toString('latin1'));
  expect(keys[0]).toContain('rgb-backup-file/chunk/0');
  expect(keys[1]).toContain('rgb-backup-file/chunk/1');
  expect(keys[2]).toContain('rgb-backup-file/manifest');
  expect(calls.every((c) => /^[0-9a-f]{194}\d+$/.test(c.auth))).toBe(true);
});

test('a missing key reads as undefined; a server error throws', async () => {
  const notFound: any = async () => ({ ok: false, status: 404 });
  expect(await createVssClient('https://v', 's', vssSigningKey(MNEMONIC), notFound).get('k')).toBeUndefined();
  const broken: any = async () => ({ ok: false, status: 500 });
  await expect(createVssClient('https://v', 's', vssSigningKey(MNEMONIC), broken).put([])).rejects.toThrow(/500/);
});
