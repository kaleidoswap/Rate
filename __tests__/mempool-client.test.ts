import {
  MempoolClient,
  MempoolError,
  accelerationPrice,
  acceleratedFeeRate,
  isMempoolNetwork,
  mempoolTxUrl,
} from '../services/mempool/MempoolClient';

type Route = { status?: number; body?: unknown; text?: string };

/** fetch stub: routes by "METHOD url", records calls. */
function stubFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const http = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = routes[`${init?.method ?? 'GET'} ${url}`];
    if (!r) return new Response('not found', { status: 404 });
    const text = r.text ?? (r.body === undefined ? '' : JSON.stringify(r.body));
    return new Response(r.status === 204 ? null : text, {
      status: r.status ?? 200,
      headers: { 'content-type': r.text != null ? 'text/plain' : 'application/json' },
    });
  });
  return { http: http as unknown as typeof fetch, calls };
}

const TXID = 'a'.repeat(64);
const SERVICES = 'https://mempool.space/api/v1/services';

// Shape returned by the live endpoint on 2026-10-02.
const ESTIMATE = {
  txSummary: { txid: TXID, effectiveVsize: 225, effectiveFee: 226, ancestorCount: 1 },
  cost: 1000,
  targetFeeRate: 2,
  nextBlockFee: 450,
  mempoolBaseFee: 75000,
  vsizeFee: 0,
  options: [{ fee: 2000 }, { fee: 1000 }, { fee: 10000 }],
  availablePaymentMethods: { bitcoin: { enabled: true, min: 1000, max: 10000000 }, applePay: { enabled: true, min: 10, max: 1000 } },
};

describe('MempoolClient', () => {
  it('builds explorer links, with the accelerator panel only on mainnet', () => {
    expect(mempoolTxUrl(TXID, 'mainnet', true)).toBe(`https://mempool.space/tx/${TXID}#accelerate`);
    expect(mempoolTxUrl(TXID, 'signet', true)).toBe(`https://mempool.space/signet/tx/${TXID}`);
    expect(mempoolTxUrl(TXID, 'testnet')).toBe(`https://mempool.space/testnet4/tx/${TXID}`);
    expect(isMempoolNetwork('mutinynet')).toBe(true);
    expect(isMempoolNetwork('regtest')).toBe(false);
    expect(isMempoolNetwork(undefined)).toBe(false);
  });

  it('reads a transaction, its vsize and RBF signalling', async () => {
    const { http } = stubFetch({
      [`GET https://mempool.space/signet/api/tx/${TXID}`]: {
        body: { txid: TXID, fee: 300, weight: 561, status: { confirmed: false }, vin: [{ sequence: 0xfffffffd }] },
      },
    });
    const tx = await new MempoolClient('signet', http).getTx(TXID);
    expect(tx).toEqual({ txid: TXID, fee: 300, vsize: 141, status: { confirmed: false }, signalsRbf: true });
  });

  it('prefers precise fee rates and falls back to recommended', async () => {
    const rates = { fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 };
    const { http } = stubFetch({ 'GET https://mempool.space/api/v1/fees/recommended': { body: rates } });
    await expect(new MempoolClient('mainnet', http).getFeeRates()).resolves.toEqual(rates);
  });

  it('parses an acceleration estimate and prices bids like mempool.space', async () => {
    const { http, calls } = stubFetch({ [`POST ${SERVICES}/accelerator/estimate`]: { body: ESTIMATE } });
    const e = await new MempoolClient('mainnet', http).estimateAcceleration(TXID);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ txInput: TXID });
    expect(e.bids).toEqual([1000, 2000, 10000]);
    expect(e.bitcoinPayment).toEqual({ min: 1000, max: 10000000 });
    expect(accelerationPrice(e, 2000)).toBe(77000);
    expect(acceleratedFeeRate(e, 2000)).toBeCloseTo(9.89, 2);
  });

  it('surfaces mempool error codes', async () => {
    const { http } = stubFetch({ [`POST ${SERVICES}/accelerator/estimate`]: { status: 400, text: 'cannot_accelerate_tx' } });
    const err = await new MempoolClient('mainnet', http).estimateAcceleration(TXID).catch(e => e);
    expect(err).toBeInstanceOf(MempoolError);
    expect(err).toMatchObject({ status: 400, code: 'cannot_accelerate_tx' });
  });

  it('refuses accelerator calls off mainnet', async () => {
    const { http, calls } = stubFetch({});
    const c = new MempoolClient('signet', http);
    expect(c.supportsAccelerator).toBe(false);
    await expect(c.estimateAcceleration(TXID)).rejects.toThrow(/only available on mainnet/);
    await expect(c.isAccelerating(TXID)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('fetches the Lightning invoice behind an acceleration order', async () => {
    const { http, calls } = stubFetch({
      [`POST ${SERVICES}/accelerator/invoice`]: { body: { btcpayInvoiceId: 'inv1' } },
      [`GET ${SERVICES}/payments/bitcoin/invoice?id=inv1`]: {
        body: [{ btcpayInvoiceId: 'inv1', btcDue: '0.00077', addresses: { BTC_LightningLike: 'lnbc770u1xyz' }, expirationTime: 1790000000 }],
      },
    });
    const inv = await new MempoolClient('mainnet', http).requestAccelerationInvoice(TXID, 2000);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ txid: TXID, maxBidBoost: 2000 });
    expect(inv).toEqual({ id: 'inv1', bolt11: 'lnbc770u1xyz', expiresAt: 1790000000 });
  });

  it('maps payment check responses', async () => {
    const check = (status: number) => {
      const { http } = stubFetch({ [`GET ${SERVICES}/payments/bitcoin/check?order_id=inv1`]: { status, body: status === 204 ? undefined : {} } });
      return new MempoolClient('mainnet', http).checkAccelerationPayment('inv1');
    };
    await expect(check(200)).resolves.toBe('settled');
    await expect(check(204)).resolves.toBe('pending');
    await expect(check(504)).resolves.toBe('pending');
    await expect(check(400)).resolves.toBe('failed');
  });

  it('reports an in-progress acceleration only for live statuses', async () => {
    const status = (s?: string) => {
      const { http } = stubFetch(s ? { [`GET ${SERVICES}/accelerator/accelerations/${TXID}`]: { body: { txid: TXID, status: s } } } : {});
      return new MempoolClient('mainnet', http).isAccelerating(TXID);
    };
    await expect(status('accelerating')).resolves.toBe(true);
    await expect(status('requested')).resolves.toBe(true);
    await expect(status('completed')).resolves.toBe(false);
    await expect(status()).resolves.toBe(false);
  });
});
