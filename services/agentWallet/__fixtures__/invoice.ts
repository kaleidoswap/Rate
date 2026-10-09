import { bech32 } from '@scure/base';

const toWords = (value: number, count: number) => {
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** (5 * i)) % 32);
  return out;
};
const TAG_P = 1;
const TAG_X = 6;

/** A structurally valid, unsigned BOLT11 invoice for tests. */
export function makeInvoice(opts: { sats?: number; paymentHash: string; timestamp: number; expiry?: number; network?: 'mainnet' | 'regtest' }): string {
  const hrp = `${opts.network === 'regtest' ? 'lnbcrt' : 'lnbc'}${opts.sats ? `${opts.sats * 10}n` : ''}`;
  const words = [
    ...toWords(opts.timestamp, 7),
    TAG_P, ...toWords(52, 2), ...bech32.toWords(Uint8Array.from(Buffer.from(opts.paymentHash, 'hex'))),
    ...(opts.expiry ? [TAG_X, ...toWords(2, 2), ...toWords(opts.expiry, 2)] : []),
    ...new Array(104).fill(0),
  ];
  return bech32.encode(hrp, words, 2000);
}
