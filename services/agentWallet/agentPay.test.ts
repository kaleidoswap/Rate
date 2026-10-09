jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { decodeAgentInvoice, payFromAgentWallet, type AgentPayWallet } from './agentPay';
import { AgentWalletStore } from './store';
import { DEFAULT_POLICY } from './policy';
import { memoryStorage } from './__fixtures__/memoryStorage';
import { makeInvoice } from './__fixtures__/invoice';

const PREIMAGE = '42'.repeat(32);
const HASH = bytesToHex(sha256(Uint8Array.from(Buffer.from(PREIMAGE, 'hex'))));
const T0 = 1_790_000_000;
const now = () => (T0 + 10) * 1000;
const invoice = (sats: number | undefined, extra: Partial<Parameters<typeof makeInvoice>[0]> = {}) =>
  makeInvoice({ sats, paymentHash: HASH, timestamp: T0, expiry: 600, ...extra });

function wallet(patch: Partial<AgentPayWallet> = {}) {
  return {
    network: 'mainnet',
    balanceSats: jest.fn(async () => 10_000),
    quoteLightningFee: jest.fn(async () => 1),
    payInvoice: jest.fn(async () => ({ preimage: PREIMAGE, feeSats: 1, status: 'confirmed' as const })),
    ...patch,
  };
}

async function setup(policy: Partial<typeof DEFAULT_POLICY> = {}) {
  const store = new AgentWalletStore(7, memoryStorage());
  await store.setEnabled(true);
  await store.savePolicy({ ...DEFAULT_POLICY, allowedServices: ['api.example.com'], ...policy });
  return store;
}

const req = (inv: string, patch = {}) => ({ invoice: inv, service: 'https://api.example.com/feed', reason: 'fetch_paid_resource', ...patch });

describe('decodeAgentInvoice', () => {
  it('reads amount, hash, expiry and network', () => {
    expect(decodeAgentInvoice(invoice(21))).toEqual({ amountSats: 21, paymentHash: HASH, expiresAt: (T0 + 600) * 1000, network: 'mainnet' });
    expect(decodeAgentInvoice(invoice(21, { network: 'regtest' }))?.network).toBe('regtest');
    expect(decodeAgentInvoice(invoice(undefined))?.amountSats).toBeUndefined();
    expect(decodeAgentInvoice('lnbc1garbage')).toBeNull();
    expect(decodeAgentInvoice('hello')).toBeNull();
  });
});

describe('payFromAgentWallet', () => {
  it('pays small amounts to allowed services on its own and logs them', async () => {
    const store = await setup();
    const w = wallet();
    const confirm = jest.fn();
    const res = await payFromAgentWallet(req(invoice(50)), { store, wallet: w, confirm, now });
    expect(res).toMatchObject({ ok: true, preimage: PREIMAGE, amountSats: 50, feeSats: 1 });
    expect(confirm).not.toHaveBeenCalled();
    expect(w.payInvoice).toHaveBeenCalledWith(invoice(50), 1);
    expect(await store.entries()).toEqual([expect.objectContaining({ kind: 'spend', status: 'paid', amountSats: 50, feeSats: 1, service: 'api.example.com', reason: 'fetch_paid_resource', paymentHash: HASH })]);
  });

  it('asks above the threshold and pays only on approval', async () => {
    const store = await setup();
    const w = wallet();
    const confirm = jest.fn(async () => true);
    expect((await payFromAgentWallet(req(invoice(500)), { store, wallet: w, confirm, now })).ok).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ service: 'api.example.com', amountSats: 500, feeSats: 1 }));

    const declined = await payFromAgentWallet(req(invoice(500)), { store, wallet: w, confirm: async () => false, now });
    expect(declined).toMatchObject({ ok: false, code: 'declined' });
    const noHandler = await payFromAgentWallet(req(invoice(500)), { store, wallet: w, now });
    expect(noHandler).toMatchObject({ ok: false, code: 'declined' });
    const throwing = await payFromAgentWallet(req(invoice(500)), { store, wallet: w, confirm: async () => { throw new Error('x'); }, now });
    expect(throwing).toMatchObject({ ok: false, code: 'declined' });
    expect(w.payInvoice).toHaveBeenCalledTimes(1);
    expect((await store.entries()).filter((e) => e.status === 'cancelled')).toHaveLength(3);
  });

  it('asks for a service that is not allowed even when cheap', async () => {
    const store = await setup();
    const confirm = jest.fn(async () => false);
    const res = await payFromAgentWallet(req(invoice(5), { service: 'https://new.example.org/x' }), { store, wallet: wallet(), confirm, now });
    expect(res.ok).toBe(false);
    expect(confirm).toHaveBeenCalled();
    expect((await store.loadPolicy())?.allowedServices).toEqual(['api.example.com']);
  });

  it('refuses over the limits without asking or paying', async () => {
    const store = await setup();
    const w = wallet();
    const confirm = jest.fn(async () => true);
    expect(await payFromAgentWallet(req(invoice(1000)), { store, wallet: w, confirm, now })).toMatchObject({ ok: false, code: 'per_payment_limit' });
    for (let i = 0; i < 5; i++) await payFromAgentWallet(req(invoice(900)), { store, wallet: w, confirm, now });
    expect(await payFromAgentWallet(req(invoice(900)), { store, wallet: w, confirm, now })).toMatchObject({ ok: false, code: 'daily_limit' });
    expect(w.payInvoice).toHaveBeenCalledTimes(5);
    expect((await store.entries()).filter((e) => e.status === 'refused')).toHaveLength(2);
  });

  it('refuses an invoice that does not match what the service announced', async () => {
    const store = await setup();
    const w = wallet();
    const res = await payFromAgentWallet(req(invoice(60), { expectedSats: 50 }), { store, wallet: w, now });
    expect(res).toMatchObject({ ok: false, code: 'amount_mismatch' });
    expect(w.payInvoice).not.toHaveBeenCalled();
  });

  it('refuses amountless, expired, unreadable and wrong-network invoices', async () => {
    const store = await setup();
    const w = wallet();
    const deps = { store, wallet: w, confirm: async () => true, now };
    expect(await payFromAgentWallet(req(invoice(undefined)), deps)).toMatchObject({ code: 'amountless' });
    expect(await payFromAgentWallet(req(invoice(50, { expiry: 25 })), deps)).toMatchObject({ code: 'expired' });
    expect(await payFromAgentWallet(req('lnbc1nope'), deps)).toMatchObject({ code: 'bad_invoice' });
    expect(await payFromAgentWallet(req(invoice(50), { service: '' }), deps)).toMatchObject({ code: 'bad_invoice' });
    expect(await payFromAgentWallet(req(invoice(50, { network: 'regtest' })), deps)).toMatchObject({ code: 'wrong_network' });
    expect(w.payInvoice).not.toHaveBeenCalled();
  });

  it('re-checks expiry after a slow approval', async () => {
    const store = await setup();
    let t = now();
    const w = wallet();
    const res = await payFromAgentWallet(req(invoice(500, { expiry: 60 })), {
      store, wallet: w, now: () => t, confirm: async () => { t += 60_000; return true; },
    });
    expect(res).toMatchObject({ code: 'expired' });
    expect(w.payInvoice).not.toHaveBeenCalled();
  });

  it('fails closed when off, unreadable or broken', async () => {
    const w = wallet();
    expect(await payFromAgentWallet(req(invoice(5)), { store: null, wallet: w, now })).toMatchObject({ code: 'disabled' });
    const off = new AgentWalletStore(7, memoryStorage());
    expect(await payFromAgentWallet(req(invoice(5)), { store: off, wallet: w, now })).toMatchObject({ code: 'disabled' });
    const damaged = new AgentWalletStore(7, memoryStorage({ 'agentWallet:enabled:7': '1', 'agentWallet:policy:7': 'garbage' }));
    expect(await payFromAgentWallet(req(invoice(5)), { store: damaged, wallet: w, now })).toMatchObject({ code: 'invalid_policy' });
    const badLog = new AgentWalletStore(7, memoryStorage({ 'agentWallet:enabled:7': '1', 'agentWallet:log:7': '{}' }));
    expect(await payFromAgentWallet(req(invoice(5)), { store: badLog, wallet: w, now })).toMatchObject({ ok: false });
    const noBalance = await setup();
    expect(await payFromAgentWallet(req(invoice(5)), { store: noBalance, wallet: wallet({ balanceSats: async () => { throw new Error('offline'); } }), now })).toMatchObject({ ok: false });
    expect(w.payInvoice).not.toHaveBeenCalled();
  });

  it('records failed and unsettled payments, and checks the proof', async () => {
    const store = await setup();
    const failing = wallet({ payInvoice: jest.fn(async () => { throw new Error('no route'); }) });
    expect(await payFromAgentWallet(req(invoice(5)), { store, wallet: failing, now })).toMatchObject({ code: 'payment_failed' });
    const pending = wallet({ payInvoice: jest.fn(async () => ({ status: 'pending' as const })) });
    expect(await payFromAgentWallet(req(invoice(6)), { store, wallet: pending, now })).toMatchObject({ code: 'payment_pending' });
    const badProof = wallet({ payInvoice: jest.fn(async () => ({ status: 'confirmed' as const, preimage: '00'.repeat(32), feeSats: 0 })) });
    expect(await payFromAgentWallet(req(invoice(7)), { store, wallet: badProof, now })).toMatchObject({ code: 'bad_proof' });
    const statuses = (await store.entries()).map((e) => [e.amountSats, e.status]);
    expect(statuses).toEqual(expect.arrayContaining([[5, 'failed'], [6, 'pending'], [7, 'paid']]));
    expect(await store.totals(now())).toEqual({ todaySats: 6 + 1 + 7, monthSats: 14 });
  });

  it('uses a bounded fee when the wallet cannot quote one', async () => {
    const store = await setup({ autoApproveSats: 200 });
    const w = wallet({ quoteLightningFee: jest.fn(async () => { throw new Error('x'); }) });
    await payFromAgentWallet(req(invoice(150)), { store, wallet: w, now });
    expect(w.payInvoice).toHaveBeenCalledWith(invoice(150), 5);
  });

  it('runs payments one at a time so limits hold', async () => {
    const store = await setup({ perPaymentSats: 1000, dailySats: 1000, autoApproveSats: 1000 });
    const w = wallet({ quoteLightningFee: async () => 0, payInvoice: jest.fn(async () => ({ preimage: PREIMAGE, feeSats: 0, status: 'confirmed' as const })) });
    const results = await Promise.all([1, 2, 3].map(() => payFromAgentWallet(req(invoice(400)), { store, wallet: w, now })));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)[0]).toMatchObject({ code: 'daily_limit' });
  });
});
