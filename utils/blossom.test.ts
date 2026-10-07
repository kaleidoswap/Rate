import { Buffer } from 'buffer';
import {
  BLOSSOM_SERVER,
  MAX_UPLOAD_BYTES,
  authorizationHeader,
  base64ToBytes,
  buildUploadAuth,
  parseBlobDescriptor,
  sha256Hex,
  sniffImageType,
  uploadToBlossom,
  type EventTemplate,
} from './blossom';

const ABC_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const abc = new Uint8Array([0x61, 0x62, 0x63]);
const sign = (t: EventTemplate) => ({ ...t, id: 'id', pubkey: 'pk', sig: 'sig' });

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe('hashing and encoding', () => {
  it('hashes bytes to lowercase hex', () => {
    expect(sha256Hex(abc)).toBe(ABC_SHA);
  });

  it('decodes base64 to bytes', () => {
    expect(Array.from(base64ToBytes('YWJj'))).toEqual([0x61, 0x62, 0x63]);
  });

  it('recognises common image types by their first bytes', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(sniffImageType(abc)).toBeNull();
  });
});

describe('upload authorisation', () => {
  it('builds a kind-24242 upload event that expires in ten minutes', () => {
    expect(buildUploadAuth(ABC_SHA, 'me.jpg', 1_000)).toEqual({
      kind: 24242,
      created_at: 1_000,
      tags: [['t', 'upload'], ['x', ABC_SHA], ['expiration', '1600']],
      content: 'Upload me.jpg',
    });
  });

  it('puts the signed event in the header as base64 JSON', () => {
    const event = sign(buildUploadAuth(ABC_SHA, 'a', 1));
    const header = authorizationHeader(event);
    expect(header.startsWith('Nostr ')).toBe(true);
    expect(JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8'))).toEqual(event);
  });
});

describe('parseBlobDescriptor', () => {
  it('returns the url', () => {
    expect(parseBlobDescriptor({ url: 'https://cdn.example/abc.jpg', sha256: ABC_SHA }, ABC_SHA)).toBe('https://cdn.example/abc.jpg');
  });

  it('rejects a missing or non-http url', () => {
    expect(() => parseBlobDescriptor({}, ABC_SHA)).toThrow('did not return a link');
    expect(() => parseBlobDescriptor({ url: 'javascript:alert(1)' }, ABC_SHA)).toThrow('did not return a link');
    expect(() => parseBlobDescriptor(null, ABC_SHA)).toThrow('did not return a link');
  });

  it('rejects a descriptor for a different file', () => {
    expect(() => parseBlobDescriptor({ url: 'https://x/y', sha256: 'ff' }, ABC_SHA)).toThrow('different file');
  });
});

describe('uploadToBlossom', () => {
  it('PUTs the bytes with a signed auth header and returns the url', async () => {
    const fetchImpl = jest.fn(async () => response(200, { url: 'https://cdn.example/abc.jpg', sha256: ABC_SHA }));
    const signer = jest.fn(sign);
    const url = await uploadToBlossom({
      bytes: abc, mimeType: 'image/jpeg', name: 'me.jpg', sign: signer, fetchImpl: fetchImpl as any, now: () => 1_000,
    });

    expect(url).toBe('https://cdn.example/abc.jpg');
    expect(signer).toHaveBeenCalledWith(buildUploadAuth(ABC_SHA, 'me.jpg', 1_000));
    const [target, init] = (fetchImpl.mock.calls[0] as unknown) as [string, RequestInit];
    expect(target).toBe(`${BLOSSOM_SERVER}/upload`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(abc);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Nostr /);
  });

  it("surfaces the server's reason when it refuses", async () => {
    const fetchImpl = jest.fn(async () => response(413, {}, { 'X-Reason': 'File too large' }));
    await expect(uploadToBlossom({ bytes: abc, mimeType: 'image/jpeg', name: 'a', sign, fetchImpl: fetchImpl as any }))
      .rejects.toThrow('blossom.primal.net: File too large');
  });

  it('reports the status when there is no reason', async () => {
    const fetchImpl = jest.fn(async () => response(401, {}));
    await expect(uploadToBlossom({ bytes: abc, mimeType: 'image/jpeg', name: 'a', sign, fetchImpl: fetchImpl as any }))
      .rejects.toThrow('refused the upload (401)');
  });

  it('explains a network failure', async () => {
    const fetchImpl = jest.fn(async () => { throw new TypeError('Network request failed'); });
    await expect(uploadToBlossom({ bytes: abc, mimeType: 'image/jpeg', name: 'a', sign, fetchImpl: fetchImpl as any }))
      .rejects.toThrow("Couldn't reach blossom.primal.net");
  });

  it('refuses empty or oversized files without contacting the server', async () => {
    const fetchImpl = jest.fn();
    await expect(uploadToBlossom({ bytes: new Uint8Array(0), mimeType: 'image/jpeg', name: 'a', sign, fetchImpl }))
      .rejects.toThrow('empty');
    await expect(uploadToBlossom({ bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1), mimeType: 'image/jpeg', name: 'a', sign, fetchImpl }))
      .rejects.toThrow('too large');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
