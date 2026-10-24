/**
 * Lossless JSON for rgb-lib swap messages.
 *
 * rgb-lib's `OnchainSwapOffer` / `Request` / `Proposal` / `Completion` carry
 * 64-bit integers (seal blindings, amounts) that do not survive `JSON.parse`:
 * a JS number keeps 53 bits, and Hermes has no `JSON.parse` source access. The
 * maker's messages are parsed here with every number kept as its source text
 * (`JsonNumber`), compared by value, and written back digit for digit, so what
 * reaches the wallet is exactly what the maker sent.
 */

/** A JSON number, kept as the text it was written as. */
export class JsonNumber {
  constructor(readonly raw: string) {}

  /** The integer value; throws for a fraction or exponent. */
  toBigInt(): bigint {
    if (!INTEGER.test(this.raw)) throw new SyntaxError(`${this.raw} is not an integer`);
    return BigInt(this.raw);
  }
}

export type LosslessValue =
  | null
  | boolean
  | string
  | JsonNumber
  | LosslessValue[]
  | { [key: string]: LosslessValue };

const INTEGER = /^-?(0|[1-9]\d*)$/;
const NUMBER = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
const WHITESPACE = /[ \t\n\r]*/y;

/** `JSON.parse`, with numbers as {@link JsonNumber}. Strict JSON only. */
export function parseLossless(text: string): LosslessValue {
  let at = 0;
  const fail = (what: string): never => {
    throw new SyntaxError(`JSON: ${what} at position ${at}`);
  };
  const skip = () => {
    WHITESPACE.lastIndex = at;
    WHITESPACE.exec(text);
    at = WHITESPACE.lastIndex;
  };
  const expect = (literal: string) => {
    if (text.startsWith(literal, at)) at += literal.length;
    else fail(`expected ${literal}`);
  };
  const string = (): string => {
    // Find the closing quote, then let JSON.parse unescape the (number-free) literal.
    const start = at;
    at += 1;
    for (;;) {
      const c = text.charCodeAt(at);
      if (Number.isNaN(c)) fail('unterminated string');
      if (c === 0x22) break;
      if (c < 0x20) fail('control character in string');
      at += c === 0x5c ? 2 : 1;
    }
    at += 1;
    try {
      return JSON.parse(text.slice(start, at)) as string;
    } catch {
      return fail('invalid string');
    }
  };
  const value = (depth: number): LosslessValue => {
    if (depth > 128) fail('nesting too deep');
    skip();
    const c = text[at];
    if (c === '{') {
      at += 1;
      const object: { [key: string]: LosslessValue } = {};
      skip();
      if (text[at] === '}') {
        at += 1;
        return object;
      }
      for (;;) {
        skip();
        if (text[at] !== '"') fail('expected a key');
        const key = string();
        skip();
        expect(':');
        if (Object.prototype.hasOwnProperty.call(object, key)) fail(`duplicate key ${key}`);
        Object.defineProperty(object, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        skip();
        if (text[at] === ',') at += 1;
        else if (text[at] === '}') {
          at += 1;
          return object;
        } else fail('expected , or }');
      }
    }
    if (c === '[') {
      at += 1;
      const array: LosslessValue[] = [];
      skip();
      if (text[at] === ']') {
        at += 1;
        return array;
      }
      for (;;) {
        array.push(value(depth + 1));
        skip();
        if (text[at] === ',') at += 1;
        else if (text[at] === ']') {
          at += 1;
          return array;
        } else fail('expected , or ]');
      }
    }
    if (c === '"') return string();
    if (text.startsWith('true', at)) return (at += 4), true;
    if (text.startsWith('false', at)) return (at += 5), false;
    if (text.startsWith('null', at)) return (at += 4), null;
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (!match) return fail('unexpected character');
    at = NUMBER.lastIndex;
    return new JsonNumber(match[0]);
  };
  const result = value(0);
  skip();
  if (at !== text.length) fail('trailing characters');
  return result;
}

/** `JSON.stringify` of a lossless value: numbers written as they were read; `bigint`s as integers. */
export function stringifyLossless(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof JsonNumber) return value.raw;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON cannot carry a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringifyLossless).join(',')}]`;
  if (typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${stringifyLossless(v)}`);
    return `{${fields.join(',')}}`;
  }
  throw new TypeError(`JSON cannot carry a ${typeof value}`);
}

function numberKey(n: JsonNumber): string {
  return INTEGER.test(n.raw) ? `i${BigInt(n.raw)}` : `f${Number(n.raw)}`;
}

/** Deep equality by value, as serde_json's `Value` compares: key order is irrelevant, `1` is not `"1"`. */
export function losslessEqual(a: LosslessValue | undefined, b: LosslessValue | undefined): boolean {
  if (a instanceof JsonNumber || b instanceof JsonNumber) {
    return a instanceof JsonNumber && b instanceof JsonNumber && numberKey(a) === numberKey(b);
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => losslessEqual(v, b[i]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && losslessEqual(a[k], b[k]));
}

/** An object's field, or undefined for anything that is not an object. */
export function field(value: LosslessValue | undefined, key: string): LosslessValue | undefined {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) return undefined;
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

/** An unsigned 64-bit integer written as a number or a decimal string, as rgb-lib and the maker do; else undefined. */
export function u64(value: LosslessValue | undefined): bigint | undefined {
  let text: string | undefined;
  if (value instanceof JsonNumber) text = value.raw;
  else if (typeof value === 'string') text = value;
  if (text === undefined || !/^(0|[1-9]\d*)$/.test(text)) return undefined;
  const n = BigInt(text);
  return n <= 0xffff_ffff_ffff_ffffn ? n : undefined;
}

/** A signed 64-bit integer written as a number; else undefined. */
export function i64(value: LosslessValue | undefined): bigint | undefined {
  if (!(value instanceof JsonNumber) || !INTEGER.test(value.raw)) return undefined;
  const n = BigInt(value.raw);
  return n >= -(2n ** 63n) && n < 2n ** 63n ? n : undefined;
}
