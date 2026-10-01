import { bech32 } from '@scure/base';

export const SSPS_RAILS = 1000000385n;
export interface OfferField { type: bigint; value: Uint8Array }
const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const MAX_BYTES = 16384;

function bigSize(n: bigint): number[] {
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error('BigSize out of range');
  if (n < 253n) return [Number(n)];
  const size = n <= 65535n ? 2 : n <= 0xffffffffn ? 4 : 8;
  return [size === 2 ? 253 : size === 4 ? 254 : 255,
    ...Array.from({ length: size }, (_, i) => Number((n >> BigInt(8 * (size - i - 1))) & 255n))];
}

function checkType(type: bigint): void {
  if (!((type >= 1n && type <= 79n) || (type >= 1000000000n && type <= 1999999999n))) {
    throw new Error('TLV outside offer ranges');
  }
}

/** Structural decoding only; the Lightning stack must validate offer semantics. */
export function decodeOffer(input: string): OfferField[] {
  if (input.length > MAX_BYTES * 3) throw new Error('Offer too large');
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) throw new Error('Mixed-case offer');
  let code = input.toLowerCase();
  code = code.replace(/([qpzry9x8gf2tvdw0s3jn54khce6mua7l])\+\s*(?=[qpzry9x8gf2tvdw0s3jn54khce6mua7l])/g, '$1');
  if (!/^lno1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/.test(code)) throw new Error('Invalid offer encoding');
  const bytes = bech32.fromWords([...code.slice(4)].map(c => alphabet.indexOf(c)));
  if (bytes.length > MAX_BYTES) throw new Error('Offer too large');
  let pos = 0;
  function read(): bigint {
    if (pos >= bytes.length) throw new Error('Truncated BigSize');
    const prefix = bytes[pos++];
    if (prefix < 253) return BigInt(prefix);
    const size = prefix === 253 ? 2 : prefix === 254 ? 4 : 8;
    if (pos + size > bytes.length) throw new Error('Truncated BigSize');
    let n = 0n;
    for (let i = 0; i < size; i++) n = (n << 8n) | BigInt(bytes[pos++]);
    if (n < (size === 2 ? 253n : size === 4 ? 65536n : 0x100000000n)) throw new Error('Noncanonical BigSize');
    return n;
  }
  const fields: OfferField[] = [];
  let previous = -1n;
  while (pos < bytes.length) {
    const type = read(), length = read();
    checkType(type);
    if (type <= previous) throw new Error('Unordered or duplicate TLV');
    if (length > BigInt(bytes.length - pos)) throw new Error('Truncated TLV');
    fields.push({ type, value: bytes.slice(pos, pos + Number(length)) });
    pos += Number(length);
    previous = type;
  }
  return fields;
}

export function encodeOffer(fields: readonly OfferField[]): string {
  if (!fields.length) throw new Error('Empty offer');
  const bytes: number[] = [];
  let previous = -1n;
  for (const { type, value } of [...fields].sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : 0)) {
    checkType(type);
    if (type === previous) throw new Error('Duplicate TLV');
    if (bytes.length + value.length + 18 > MAX_BYTES) throw new Error('Offer too large');
    bytes.push(...bigSize(type), ...bigSize(BigInt(value.length)), ...value);
    previous = type;
  }
  return 'lno1' + bech32.toWords(Uint8Array.from(bytes)).map(n => alphabet[n]).join('');
}

export function validateRails(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some(r => typeof r !== 'string' || !/^[a-z][a-z0-9-]*(?::[a-zA-Z0-9_./-]+)?$/.test(r) || r.length > 256)) {
    throw new Error('Invalid rail list');
  }
  if (new Set(value).size !== value.length) throw new Error('Duplicate rail');
}

export function acceptedRails(offer: string): string[] {
  const field = decodeOffer(offer).find(f => f.type === SSPS_RAILS);
  const rails: unknown = field ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(field.value)) : [];
  validateRails(rails);
  return rails.includes('ln') ? [...rails] : [...rails, 'ln'];
}

/** Issuer-side only: changing fields changes the offer identity. Register the result with the issuer. */
export function withAcceptedRails(offer: string, rails: string[]): string {
  validateRails(rails);
  return encodeOffer([...decodeOffer(offer).filter(f => f.type !== SSPS_RAILS), {
    type: SSPS_RAILS, value: new TextEncoder().encode(JSON.stringify(rails)),
  }]);
}
