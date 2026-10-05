jest.mock('../utils/decodeInvoice', () => ({
  decodeBolt11: jest.fn((invoice: string) => ({ kind: 'bolt11', raw: invoice, amountSats: Number(invoice.split(':')[1]) })),
}));

import { buildClaimTx } from '@universal-bolt12/swap-market';
import type { SwapAttempt } from '@universal-bolt12/swap-market';
import {
  CLAIM_VBYTES,
  accelerationTarget,
  accelerateWithMempool,
  bumpClaimFee,
  mempoolOptions,
  planAcceleration,
} from '../services/TxAccelerationService';
import type { AccelerationDeps } from '../services/TxAccelerationService';
import type { AccelerationEstimate, MempoolClient } from '../services/mempool/MempoolClient';

const TXID = 'b'.repeat(64);
const LOCKUP = 'c'.repeat(64);

const estimate = (over: Partial<AccelerationEstimate> = {}): AccelerationEstimate => ({
  txid: TXID, effectiveVsize: 200, effectiveFee: 200, ancestorCount: 1, targetFeeRate: 5, nextBlockFee: 1000,
  mempoolBaseFee: 50000, vsizeFee: 0, bids: [1000, 2000, 10000], bitcoinPayment: { min: 1000, max: 10_000_000 },
  unavailable: false, ...over,
});

function fakeClient(over: Partial<Record<keyof MempoolClient, any>> = {}): MempoolClient {
  return {
    network: 'mainnet',
    supportsAccelerator: true,
    getTxStatus: jest.fn(async () => ({ confirmed: false })),
    isAccelerating: jest.fn(async () => false),
    estimateAcceleration: jest.fn(async () => estimate()),
    getFeeRates: jest.fn(async () => ({ fastestFee: 8, halfHourFee: 4, hourFee: 2, economyFee: 1, minimumFee: 1 })),
    broadcast: jest.fn(),
    requestAccelerationInvoice: jest.fn(),
    checkAccelerationPayment: jest.fn(async () => 'settled'),
    ...over,
  } as unknown as MempoolClient;
}

function attemptStore(initial: SwapAttempt[] = []) {
  const map = new Map(initial.map(a => [a.id, a]));
  return {
    save: jest.fn(async (a: SwapAttempt) => { map.set(a.id, a); }),
    load: jest.fn(async (id: string) => map.get(id) ?? null),
    list: jest.fn(async () => [...map.values()]),
  };
}

function deps(client: MempoolClient, over: Partial<AccelerationDeps> = {}): AccelerationDeps {
  return {
    client: () => client,
    attempts: attemptStore(),
    secrets: { put: jest.fn(), get: jest.fn(async () => null) },
    payInvoice: jest.fn(async () => undefined),
    sleep: async () => undefined,
    ...over,
  };
}

const claimKey = '22'.repeat(32);
const preimage = '11'.repeat(32);
const destination = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function claimedAttempt(fee = 2 * CLAIM_VBYTES, over: Partial<SwapAttempt> = {}): SwapAttempt {
  return {
    id: 'swap1',
    stage: 'claimed',
    quote: {} as any,
    swap: {
      id: 'swap1', network: 'mainnet', server: 'srv', serverRelays: [], paymentHash: '00'.repeat(32),
      claimPubkey: '02' + '33'.repeat(32), redeemScript: '51',
      lockupAddress: 'bc1qlockup', timeoutBlockHeight: 900000, onchainAmount: 50_000, invoice: 'lnbc1', invoiceAmount: 51_000,
      destination,
    },
    lockup: { txid: LOCKUP, vout: 0, confirmed: false },
    claim: { txid: TXID, hex: 'old', fee },
    updatedAt: 1,
    ...over,
  };
}

describe('accelerationTarget', () => {
  const item = (over: Record<string, unknown>) => ({
    id: 'x', type: 'send', source: 'onchain', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '1',
    status: 'pending', txid: TXID, layer: 'L1', network: 'mainnet', swapAttemptId: 'swap1', ...over,
  }) as any;

  it('targets pending on-chain items on a mempool.space network', () => {
    expect(accelerationTarget(item({}))).toEqual({ txid: TXID, network: 'mainnet', swapAttemptId: 'swap1' });
  });

  it('ignores confirmed, off-chain, txid-less and unsupported-network items', () => {
    expect(accelerationTarget(item({ status: 'confirmed' }))).toBeNull();
    expect(accelerationTarget(item({ layer: 'LN' }))).toBeNull();
    expect(accelerationTarget(item({ txid: '' }))).toBeNull();
    expect(accelerationTarget(item({ network: 'regtest' }))).toBeNull();
    expect(accelerationTarget(item({ network: undefined }))).toBeNull();
  });
});

describe('mempoolOptions', () => {
  it('prices each bid, recommends the second tier like mempool.space', () => {
    const opts = mempoolOptions(estimate());
    expect(opts.map(o => o.kind === 'mempool' && [o.bid, o.price, o.feeRate, o.recommended])).toEqual([
      [1000, 51000, 6, false],
      [2000, 52000, 11, true],
      [10000, 60000, 51, false],
    ]);
  });

  it('drops tiers outside the payment limits and offers nothing when unavailable', () => {
    expect(mempoolOptions(estimate({ bitcoinPayment: { min: 1000, max: 55000 } })).map(o => o.id)).toEqual(['mempool-1000', 'mempool-2000']);
    expect(mempoolOptions(estimate({ unavailable: true }))).toEqual([]);
  });
});

describe('planAcceleration', () => {
  it('only links to the explorer once confirmed', async () => {
    const client = fakeClient({ getTxStatus: jest.fn(async () => ({ confirmed: true })) });
    const plan = await planAcceleration({ txid: TXID, network: 'mainnet' }, deps(client));
    expect(plan.status).toBe('confirmed');
    expect(plan.options.map(o => o.kind)).toEqual(['explorer']);
    expect(client.estimateAcceleration).not.toHaveBeenCalled();
  });

  it('offers mempool tiers plus the explorer for an unconfirmed mainnet tx', async () => {
    const plan = await planAcceleration({ txid: TXID, network: 'mainnet' }, deps(fakeClient()));
    expect(plan.options.map(o => o.kind)).toEqual(['mempool', 'mempool', 'mempool', 'explorer']);
    expect(plan.options[3]).toMatchObject({ url: `https://mempool.space/tx/${TXID}#accelerate` });
  });

  it('explains why the accelerator is missing off mainnet or when mempool refuses', async () => {
    const signet = fakeClient({ supportsAccelerator: false });
    const plan = await planAcceleration({ txid: TXID, network: 'signet' }, deps(signet));
    expect(plan.notes).toContain('Mempool Accelerator only works on mainnet.');
    expect(signet.estimateAcceleration).not.toHaveBeenCalled();

    const { MempoolError } = jest.requireActual('../services/mempool/MempoolClient');
    const refused = fakeClient({ estimateAcceleration: jest.fn(async () => { throw new MempoolError('x', 400, 'cannot_accelerate_tx'); }) });
    const p2 = await planAcceleration({ txid: TXID, network: 'mainnet' }, deps(refused));
    expect(p2.notes).toContain('Mempool Accelerator cannot accelerate this transaction.');
    expect(p2.options.map(o => o.kind)).toEqual(['explorer']);
  });

  it('skips a new quote while mempool is already accelerating', async () => {
    const client = fakeClient({ isAccelerating: jest.fn(async () => true) });
    const plan = await planAcceleration({ txid: TXID, network: 'mainnet' }, deps(client));
    expect(plan.accelerating).toBe(true);
    expect(client.estimateAcceleration).not.toHaveBeenCalled();
  });

  it('offers claim fee bumps at least 1 sat/vB above the current rate', async () => {
    const attempts = attemptStore([claimedAttempt(5 * CLAIM_VBYTES)]);
    const plan = await planAcceleration({ txid: TXID, network: 'mainnet', swapAttemptId: 'swap1' }, deps(fakeClient(), { attempts }));
    const bumps = plan.options.filter(o => o.kind === 'rbf-claim');
    // halfHour 4 is below 5 + 1, so it is lifted to 6; fastest is 8.
    expect(bumps.map(o => o.kind === 'rbf-claim' && [o.label, o.feeRate, o.extraFee])).toEqual([
      ['Within an hour', 6, CLAIM_VBYTES],
      ['Next block', 8, 3 * CLAIM_VBYTES],
    ]);
  });

  it('explains when a swap has no claim to bump yet', async () => {
    const attempts = attemptStore([claimedAttempt(0, { stage: 'lockup_seen', claim: undefined })]);
    const plan = await planAcceleration({ txid: LOCKUP, network: 'mainnet', swapAttemptId: 'swap1' }, deps(fakeClient(), { attempts }));
    expect(plan.options.some(o => o.kind === 'rbf-claim')).toBe(false);
    expect(plan.notes.join(' ')).toMatch(/not broadcast yet/);
  });
});

describe('bumpClaimFee', () => {
  const secrets = { put: jest.fn(), get: jest.fn(async () => JSON.stringify({ preimage, claimPrivkey: claimKey })) };
  const replacement = buildClaimTx({
    txid: LOCKUP, vout: 0, amount: 50_000, redeemScript: '51', preimage, claimPrivkey: claimKey, destination, feeRate: 6, network: 'mainnet',
  });

  it('re-signs the claim, broadcasts it, and saves it only once accepted', async () => {
    const attempts = attemptStore([claimedAttempt()]);
    const client = fakeClient({ broadcast: jest.fn(async () => replacement.txid) });
    await expect(bumpClaimFee('swap1', 6, deps(client, { attempts, secrets }))).resolves.toBe(replacement.txid);
    expect(client.broadcast).toHaveBeenCalledWith(replacement.hex);
    expect((await attempts.load('swap1'))?.claim).toEqual(replacement);
    expect(replacement.fee).toBe(6 * CLAIM_VBYTES);
  });

  it('keeps the old claim when the replacement is rejected or mismatched', async () => {
    const attempts = attemptStore([claimedAttempt()]);
    const rejected = fakeClient({ broadcast: jest.fn(async () => { throw new Error('insufficient fee'); }) });
    await expect(bumpClaimFee('swap1', 6, deps(rejected, { attempts, secrets }))).rejects.toThrow('insufficient fee');
    const other = fakeClient({ broadcast: jest.fn(async () => 'f'.repeat(64)) });
    await expect(bumpClaimFee('swap1', 6, deps(other, { attempts, secrets }))).rejects.toThrow(/another transaction id/);
    expect(attempts.save).not.toHaveBeenCalled();
  });

  it('rejects a fee rate that does not outbid the current claim', async () => {
    const attempts = attemptStore([claimedAttempt(5 * CLAIM_VBYTES)]);
    await expect(bumpClaimFee('swap1', 5.5, deps(fakeClient(), { attempts, secrets }))).rejects.toThrow(/at least 1 sat\/vB higher/);
  });
});

describe('accelerateWithMempool', () => {
  const invoiceClient = (bolt11: string, check = 'settled') => fakeClient({
    requestAccelerationInvoice: jest.fn(async () => ({ id: 'inv1', bolt11 })),
    checkAccelerationPayment: jest.fn(async () => check),
  });

  it('pays an invoice within the approved price and waits for settlement', async () => {
    const d = deps(invoiceClient('lnbc520u1abc:52000'));
    const onInvoice = jest.fn();
    await expect(accelerateWithMempool({ txid: TXID, bid: 2000, approvedPrice: 52000, onInvoice }, d)).resolves.toBe('accelerating');
    expect(d.payInvoice).toHaveBeenCalledWith('lnbc520u1abc:52000');
    expect(onInvoice).toHaveBeenCalledWith(52000);
  });

  it('never pays more than approved, or a non-mainnet invoice', async () => {
    const over = deps(invoiceClient('lnbc600u1abc:60000'));
    await expect(accelerateWithMempool({ txid: TXID, bid: 2000, approvedPrice: 52000 }, over)).rejects.toThrow(/more than the 52000 sats/);
    const regtest = deps(invoiceClient('lnbcrt520u1abc:52000'));
    await expect(accelerateWithMempool({ txid: TXID, bid: 2000, approvedPrice: 52000 }, regtest)).rejects.toThrow(/another network/);
    expect(over.payInvoice).not.toHaveBeenCalled();
    expect(regtest.payInvoice).not.toHaveBeenCalled();
  });

  it('reports a payment mempool has not confirmed in time', async () => {
    const d = deps(invoiceClient('lnbc520u1abc:52000', 'pending'));
    await expect(accelerateWithMempool({ txid: TXID, bid: 2000, approvedPrice: 52000 }, d, { timeoutMs: 0 })).resolves.toBe('payment-pending');
  });
});
