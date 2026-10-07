import { findProof, hashFromPreimage, parseProofs, preimageMatches, proofFromResult, upsertProof } from './payment-proofs';

const PREIMAGE = '00'.repeat(32);
// sha256 of 32 zero bytes
const HASH = '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925';

describe('payment proofs', () => {
  it('hashes a preimage to its payment hash', () => {
    expect(hashFromPreimage(PREIMAGE)).toBe(HASH);
    expect(preimageMatches(PREIMAGE, HASH.toUpperCase())).toBe(true);
    expect(preimageMatches(PREIMAGE, 'ff'.repeat(32))).toBe(false);
  });

  it('keeps the account ids that differ from the hash, so Spark items can be matched', () => {
    const proof = proofFromResult({ preimage: PREIMAGE, paymentHash: 'spark-request-1' }, 1);
    expect(proof).toEqual({ paymentHash: HASH, preimage: PREIMAGE, refs: ['spark-request-1'], savedAt: 1 });
    expect(proofFromResult({ payment_preimage: PREIMAGE, payment_hash: HASH }, 1)?.refs).toEqual([]);
  });

  it('ignores results without a valid preimage', () => {
    expect(proofFromResult({ paymentHash: HASH, status: 'pending' }, 1)).toBeNull();
    expect(proofFromResult({ preimage: 'not-hex' }, 1)).toBeNull();
    expect(proofFromResult(undefined, 1)).toBeNull();
  });

  it('merges refs for the same payment and finds it by any id', () => {
    let list = upsertProof([], proofFromResult({ preimage: PREIMAGE, paymentHash: 'a' }, 1)!);
    list = upsertProof(list, proofFromResult({ preimage: PREIMAGE, txid: 'b' }, 2)!);
    expect(list).toHaveLength(1);
    expect(list[0].refs).toEqual(['a', 'b']);
    expect(findProof(list, [undefined, 'B'])?.preimage).toBe(PREIMAGE);
    expect(findProof(list, [HASH])?.preimage).toBe(PREIMAGE);
    expect(findProof(list, ['nope'])).toBeNull();
    expect(findProof(list, [])).toBeNull();
  });

  it('drops damaged stored entries', () => {
    expect(parseProofs('not json')).toEqual([]);
    expect(parseProofs(JSON.stringify([{ preimage: 'x' }, { paymentHash: HASH, preimage: PREIMAGE, refs: [] }]))).toHaveLength(1);
  });
});
