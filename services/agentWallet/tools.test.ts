jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { buildAgentToolSource, parseL402Challenge, BUDGET_TOOL, PAID_RESOURCE_TOOL } from './tools';
import { bindAgentConfirm, agentConfirm } from './confirm';
import { AgentWalletStore } from './store';
import { DEFAULT_POLICY } from './policy';
import { memoryStorage } from './__fixtures__/memoryStorage';
import { makeInvoice } from './__fixtures__/invoice';

const PREIMAGE = '07'.repeat(32);
const HASH = bytesToHex(sha256(Uint8Array.from(Buffer.from(PREIMAGE, 'hex'))));
const T0 = 1_790_000_000;
const now = () => (T0 + 5) * 1000;
const invoice = (sats: number) => makeInvoice({ sats, paymentHash: HASH, timestamp: T0, expiry: 600 });
const URL_ = 'https://api.example.com/feed';

function response(status: number, opts: { headers?: Record<string, string>; body?: string; url?: string } = {}) {
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status, ok: status >= 200 && status < 300, url: opts.url ?? URL_,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => opts.body ?? '',
  } as unknown as Response;
}
const challenge = (inv: string, extra: Record<string, string> = {}, body?: string) =>
  response(402, { headers: { 'WWW-Authenticate': `L402 macaroon="AgEMYWNj", invoice="${inv}"`, ...extra }, body });

async function setup(policy: Partial<typeof DEFAULT_POLICY> = {}) {
  const store = new AgentWalletStore(9, memoryStorage());
  await store.setEnabled(true);
  await store.savePolicy({ ...DEFAULT_POLICY, allowedServices: ['api.example.com'], ...policy });
  const wallet = {
    network: 'mainnet',
    balanceSats: jest.fn(async () => 5000),
    quoteLightningFee: jest.fn(async () => 0),
    payInvoice: jest.fn(async () => ({ preimage: PREIMAGE, feeSats: 0, status: 'confirmed' as const })),
  };
  return { store, wallet };
}

function source(store: AgentWalletStore | null, wallet: any, fetchImpl: jest.Mock, confirm?: jest.Mock) {
  return buildAgentToolSource({ payDeps: async () => ({ store, wallet }), confirm: () => confirm, fetchImpl: fetchImpl as any, now });
}

describe('parseL402Challenge', () => {
  it('reads L402 and LSAT challenges', () => {
    expect(parseL402Challenge('L402 macaroon="abc=", invoice="lnbc1x"')).toEqual({ scheme: 'L402', macaroon: 'abc=', invoice: 'lnbc1x' });
    expect(parseL402Challenge('Basic realm="x", LSAT token="t_1", invoice="lnbc1y"')).toEqual({ scheme: 'LSAT', macaroon: 't_1', invoice: 'lnbc1y' });
    expect(parseL402Challenge('L402 invoice="lnbc1x"')).toBeNull();
    expect(parseL402Challenge('L402 macaroon="a b", invoice="lnbc1x"')).toBeNull();
    expect(parseL402Challenge(null)).toBeNull();
  });
});

describe('fetch_paid_resource', () => {
  it('pays the 402 from the Agent wallet, retries with the proof and logs it', async () => {
    const { store, wallet } = await setup();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(challenge(invoice(21), { 'X-Amount-Sats': '21' }))
      .mockResolvedValueOnce(response(200, { body: '{"price":64000}' }));
    const result = await source(store, wallet, fetchImpl).execute(PAID_RESOURCE_TOOL, { url: URL_ });
    expect(result).toEqual({ paid_sats: 21, fee_sats: 0, service: 'api.example.com', data: { price: 64000 } });
    expect(fetchImpl.mock.calls[1][1].headers).toEqual({ Authorization: `L402 AgEMYWNj:${PREIMAGE}` });
    expect((await store.entries())[0]).toMatchObject({ kind: 'spend', status: 'paid', amountSats: 21, service: 'api.example.com', reason: PAID_RESOURCE_TOOL });
  });

  it('returns free resources without paying', async () => {
    const { store, wallet } = await setup();
    const fetchImpl = jest.fn().mockResolvedValueOnce(response(200, { body: 'hello' }));
    expect(await source(store, wallet, fetchImpl).execute(PAID_RESOURCE_TOOL, { url: URL_ })).toEqual({ paid_sats: 0, data: 'hello' });
    expect(wallet.payInvoice).not.toHaveBeenCalled();
  });

  it('asks above the threshold through the bound confirm sheet', async () => {
    const { store, wallet } = await setup();
    const ask = jest.fn(async () => ({ approved: true }));
    const unbind = bindAgentConfirm(ask);
    const fetchImpl = jest.fn().mockResolvedValueOnce(challenge(invoice(500))).mockResolvedValueOnce(response(200, { body: '{}' }));
    await buildAgentToolSource({ payDeps: async () => ({ store, wallet }), confirm: agentConfirm, fetchImpl: fetchImpl as any, now }).execute(PAID_RESOURCE_TOOL, { url: URL_ });
    unbind();
    expect(ask).toHaveBeenCalledWith({ name: PAID_RESOURCE_TOOL, arguments: expect.objectContaining({ agent_wallet: true, amount_sats: 500, service: 'api.example.com' }) });
    expect(agentConfirm()).toBeUndefined();
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
  });

  it('refuses over-limit invoices and says why', async () => {
    const { store, wallet } = await setup();
    const fetchImpl = jest.fn().mockResolvedValueOnce(challenge(invoice(5000)));
    await expect(source(store, wallet, fetchImpl, jest.fn(async () => true)).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/Not paid: .*per-payment limit/);
    expect(wallet.payInvoice).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses when the invoice does not match the announced price', async () => {
    const { store, wallet } = await setup();
    for (const announced of [challenge(invoice(50), { 'X-Amount-Sats': '5' }), challenge(invoice(50), {}, '{"amount_sats": 5}')]) {
      const fetchImpl = jest.fn().mockResolvedValueOnce(announced);
      await expect(source(store, wallet, fetchImpl).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/Not paid: .*5 sats/);
    }
    const unclear = jest.fn().mockResolvedValueOnce(challenge(invoice(50), { 'X-Amount-Sats': '50' }, '{"amount_sats": 49}'));
    await expect(source(store, wallet, unclear).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/unclear price/);
    expect(wallet.payInvoice).not.toHaveBeenCalled();
  });

  it('refuses expired invoices, redirects to other sites and missing challenges', async () => {
    const { store, wallet } = await setup();
    const expired = makeInvoice({ sats: 10, paymentHash: HASH, timestamp: T0 - 3600, expiry: 600 });
    await expect(source(store, wallet, jest.fn().mockResolvedValueOnce(challenge(expired))).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/expired/);
    const redirected = response(402, { url: 'https://evil.example.net/pay', headers: { 'WWW-Authenticate': `L402 macaroon="m", invoice="${invoice(10)}"` } });
    await expect(source(store, wallet, jest.fn().mockResolvedValueOnce(redirected)).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/different site/);
    await expect(source(store, wallet, jest.fn().mockResolvedValueOnce(response(402))).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/L402/);
    expect(wallet.payInvoice).not.toHaveBeenCalled();
  });

  it('only fetches https URLs', async () => {
    const { store, wallet } = await setup();
    const fetchImpl = jest.fn();
    for (const url of ['http://api.example.com/x', 'ftp://a.com', 'nonsense', 'https://u:p@api.example.com/']) {
      await expect(source(store, wallet, fetchImpl).execute(PAID_RESOURCE_TOOL, { url })).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cannot pay when the Agent wallet is off, and asks for unknown services', async () => {
    const off = new AgentWalletStore(9, memoryStorage());
    const fetchImpl = jest.fn().mockResolvedValue(challenge(invoice(10)));
    await expect(source(off, null, fetchImpl).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/Agent wallet is off/);
    const { store, wallet } = await setup();
    const confirm = jest.fn(async () => false);
    const other = jest.fn().mockResolvedValue(response(402, { url: 'https://new.example.org/x', headers: { 'WWW-Authenticate': `L402 macaroon="m", invoice="${invoice(10)}"` } }));
    await expect(source(store, wallet, other, confirm).execute(PAID_RESOURCE_TOOL, { url: 'https://new.example.org/x' })).rejects.toThrow(/declined/);
    expect(confirm).toHaveBeenCalled();
    expect((await store.loadPolicy())?.allowedServices).toEqual(['api.example.com']);
  });

  it('reports a paid call whose retry failed', async () => {
    const { store, wallet } = await setup();
    const fetchImpl = jest.fn().mockResolvedValueOnce(challenge(invoice(10))).mockResolvedValueOnce(response(500));
    await expect(source(store, wallet, fetchImpl).execute(PAID_RESOURCE_TOOL, { url: URL_ })).rejects.toThrow(/Paid 10 sats, but the service answered 500/);
  });
});

describe('agent_budget_status', () => {
  it('reports balance and what is left', async () => {
    const { store, wallet } = await setup();
    await store.add({ kind: 'spend', amountSats: 300, feeSats: 2, status: 'paid', service: 'api.example.com', at: now() });
    const status = await source(store, wallet, jest.fn()).execute(BUDGET_TOOL, {});
    expect(status).toEqual({
      enabled: true, paused: false, balance_sats: 5000, per_payment_limit_sats: 1000,
      spent_today_sats: 302, left_today_sats: 4698, spent_this_month_sats: 302, left_this_month_sats: 49_698,
      pays_without_asking_below_sats: 100, allowed_services: ['api.example.com'],
    });
  });

  it('says when it is off or its rules are unreadable', async () => {
    expect(await source(null, null, jest.fn()).execute(BUDGET_TOOL, {})).toMatchObject({ enabled: false });
    const damaged = new AgentWalletStore(9, memoryStorage({ 'agentWallet:enabled:9': '1', 'agentWallet:policy:9': 'x' }));
    expect(await source(damaged, null, jest.fn()).execute(BUDGET_TOOL, {})).toMatchObject({ enabled: true, usable: false });
  });

  it('is read-only and exposes no way to change the rules', async () => {
    const { store, wallet } = await setup();
    const src = source(store, wallet, jest.fn());
    const names = (await src.listTools()).map((t) => t.name);
    expect(names).toEqual([PAID_RESOURCE_TOOL, BUDGET_TOOL]);
    const before = await store.loadPolicy();
    await src.execute(BUDGET_TOOL, { perPaymentSats: 10_000_000, allowedServices: ['evil.com'], paused: false });
    expect(await store.loadPolicy()).toEqual(before);
  });
});
