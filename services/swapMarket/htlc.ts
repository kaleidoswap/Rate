import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { Address, OutScript, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import type { SwapNetwork } from './types';

type Token = number | Uint8Array;

export function btcNetwork(n: SwapNetwork) {
  return n === 'mainnet' ? NETWORK : TEST_NETWORK;
}

export function addressToScript(addr: string, n: SwapNetwork): Uint8Array {
  return OutScript.encode(Address(btcNetwork(n)).decode(addr));
}

function tokenize(s: Uint8Array): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < s.length;) {
    const op = s[i++];
    let len = -1;
    if (op >= 0x01 && op <= 0x4b) len = op;
    else if (op === 0x4c) len = s[i++];
    else if (op === 0x4d) { len = s[i] | (s[i + 1] << 8); i += 2; }
    if (len < 0) { out.push(op); continue; }
    if (i + len > s.length) throw new Error('truncated push in swap script');
    out.push(s.slice(i, i + len));
    i += len;
  }
  return out;
}

function scriptNum(b: Uint8Array): number {
  let n = 0;
  for (let i = b.length - 1; i >= 0; i--) n = n * 256 + (i === b.length - 1 ? b[i] & 0x7f : b[i]);
  return b.length && b[b.length - 1] & 0x80 ? -n : n;
}

const OP = { SIZE: 0x82, EQUAL: 0x87, IF: 0x63, HASH160: 0xa9, EQUALVERIFY: 0x88, ELSE: 0x67, DROP: 0x75, CLTV: 0xb1, ENDIF: 0x68, CHECKSIG: 0xac };

/** Checks a reverse-swap script against Electrum's WITNESS_TEMPLATE_SWAP and our terms. */
export function checkReverseScript(p: {
  redeemScript: string;
  lockupAddress: string;
  paymentHash: string;
  claimPubkey: string;
  timeoutBlockHeight: number;
  network: SwapNetwork;
}): void {
  const script = hexToBytes(p.redeemScript);
  const t = tokenize(script);
  const isOp = (i: number, op: number) => t[i] === op;
  const isPush = (i: number, len?: number) => t[i] instanceof Uint8Array && (len === undefined || (t[i] as Uint8Array).length === len);
  const shape = t.length === 16
    && isOp(0, OP.SIZE) && isPush(1) && isOp(2, OP.EQUAL) && isOp(3, OP.IF) && isOp(4, OP.HASH160)
    && isPush(5, 20) && isOp(6, OP.EQUALVERIFY) && isPush(7, 33) && isOp(8, OP.ELSE) && isOp(9, OP.DROP)
    && isPush(10) && isOp(11, OP.CLTV) && isOp(12, OP.DROP) && isPush(13, 33) && isOp(14, OP.ENDIF) && isOp(15, OP.CHECKSIG);
  if (!shape) throw new Error('swap script does not match the Electrum template');
  if (scriptNum(t[1] as Uint8Array) !== 32) throw new Error('swap script does not require a 32-byte preimage');
  if (bytesToHex(t[5] as Uint8Array) !== bytesToHex(ripemd160(hexToBytes(p.paymentHash)))) throw new Error('swap script locks another payment hash');
  if (bytesToHex(t[7] as Uint8Array) !== p.claimPubkey) throw new Error('swap script pays another claim key');
  if (scriptNum(t[10] as Uint8Array) !== p.timeoutBlockHeight) throw new Error('swap script timeout differs from the reply');
  const expected = concatBytes(new Uint8Array([0x00, 0x20]), sha256(script));
  if (bytesToHex(addressToScript(p.lockupAddress, p.network)) !== bytesToHex(expected)) throw new Error('lockup address does not match the script');
}

const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const varint = (n: number) => n < 0xfd ? new Uint8Array([n]) : concatBytes(new Uint8Array([0xfd]), new Uint8Array([n & 0xff, n >> 8]));
const varbytes = (b: Uint8Array) => concatBytes(varint(b.length), b);
const dsha = (b: Uint8Array) => sha256(sha256(b));
const rev = (hex: string) => hexToBytes(hex).reverse();

/** Witness size of a claim input, in weight units, for fee estimation. */
const CLAIM_VBYTES = 11 + 41 + 43 + Math.ceil((1 + 73 + 33 + 120) / 4);

export function claimFee(feeRate: number): number {
  return Math.ceil(CLAIM_VBYTES * feeRate);
}

/** Builds the signed claim: one P2WSH input spent with [sig, preimage, script]. */
export function buildClaimTx(p: {
  txid: string;
  vout: number;
  amount: number;
  redeemScript: string;
  preimage: string;
  claimPrivkey: string;
  destination: string;
  feeRate: number;
  network: SwapNetwork;
}): { hex: string; txid: string; fee: number } {
  const fee = claimFee(p.feeRate);
  const outValue = p.amount - fee;
  if (outValue < 546) throw new Error('swap amount does not cover the claim fee');
  const script = hexToBytes(p.redeemScript);
  const outScript = addressToScript(p.destination, p.network);
  const version = u32(2), locktime = u32(0), sequence = u32(0xfffffffd);
  const outpoint = concatBytes(rev(p.txid), u32(p.vout));
  const output = concatBytes(u64(outValue), varbytes(outScript));
  const preimage143 = concatBytes(
    version, dsha(outpoint), dsha(sequence), outpoint, varbytes(script),
    u64(p.amount), sequence, dsha(output), locktime, u32(1),
  );
  const sig = secp256k1.sign(dsha(preimage143), hexToBytes(p.claimPrivkey), { lowS: true }) as any;
  const der: Uint8Array = typeof sig.toDERRawBytes === 'function' ? sig.toDERRawBytes() : sig.toBytes('der');
  const witness = concatBytes(varint(3), varbytes(concatBytes(der, new Uint8Array([0x01]))), varbytes(hexToBytes(p.preimage)), varbytes(script));
  const body = concatBytes(varint(1), outpoint, varint(0), sequence, varint(1), output);
  const hex = bytesToHex(concatBytes(version, new Uint8Array([0x00, 0x01]), body, witness, locktime));
  const txid = bytesToHex(dsha(concatBytes(version, body, locktime)).reverse());
  return { hex, txid, fee };
}
