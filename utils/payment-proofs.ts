/**
 * Lightning proof of payment: the preimage whose sha256 is the invoice's
 * payment hash. Kept after a payment so Activity can show it.
 */
import { sha256 } from '@noble/hashes/sha2';

export interface PaymentProof {
  /** sha256(preimage), the invoice's payment hash. */
  paymentHash: string;
  preimage: string;
  /** Other ids the account reported for this payment (e.g. a Spark request id). */
  refs: string[];
  savedAt: number;
}

export const PAYMENT_PROOFS_LIMIT = 500;

export function isPreimage(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export function hashFromPreimage(preimage: string): string {
  const bytes = Uint8Array.from(preimage.match(/../g)!.map((b) => parseInt(b, 16)));
  return Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function preimageMatches(preimage: string, paymentHash: string): boolean {
  return isPreimage(preimage) && hashFromPreimage(preimage.toLowerCase()) === paymentHash.toLowerCase();
}

/** A proof from a send result, or null when it carries no valid preimage. */
export function proofFromResult(result: any, now: number): PaymentProof | null {
  const preimage = result?.preimage ?? result?.payment_preimage;
  if (!isPreimage(preimage)) return null;
  const lower = preimage.toLowerCase();
  const paymentHash = hashFromPreimage(lower);
  const refs = [result?.paymentHash, result?.payment_hash, result?.id, result?.txid]
    .filter((r): r is string => typeof r === 'string' && r.length > 0 && r.toLowerCase() !== paymentHash);
  return { paymentHash, preimage: lower, refs: Array.from(new Set(refs)), savedAt: now };
}

export function upsertProof(list: PaymentProof[], proof: PaymentProof): PaymentProof[] {
  const prev = list.find((p) => p.paymentHash === proof.paymentHash);
  const merged = prev ? { ...proof, refs: Array.from(new Set([...prev.refs, ...proof.refs])) } : proof;
  return [merged, ...list.filter((p) => p.paymentHash !== proof.paymentHash)].slice(0, PAYMENT_PROOFS_LIMIT);
}

export function parseProofs(raw: string | null): PaymentProof[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((p) => p && isPreimage(p.preimage) && typeof p.paymentHash === 'string' && Array.isArray(p.refs))
      : [];
  } catch {
    return [];
  }
}

/** The proof matching any of an activity item's ids (payment hash, txid, request id). */
export function findProof(list: PaymentProof[], keys: Array<string | undefined>): PaymentProof | null {
  const wanted = keys.filter((k): k is string => !!k).map((k) => k.toLowerCase());
  if (!wanted.length) return null;
  return (
    list.find((p) => wanted.includes(p.paymentHash) || p.refs.some((r) => wanted.includes(r.toLowerCase()))) ?? null
  );
}
