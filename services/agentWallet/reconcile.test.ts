jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { reconcileAgentWallet, reconcilePending } from './reconcile';
import { payFromAgentWallet, type AgentPayWallet } from './agentPay';
import { AgentWalletStore } from './store';
import { DEFAULT_POLICY } from './policy';
import { lookupSparkSend, readSendRequest } from './account';
import { memoryStorage } from './__fixtures__/memoryStorage';
import { makeInvoice } from './__fixtures__/invoice';

jest.mock('../protocols/MobileSparkAdapter', () => ({ MobileSparkAdapter: class {} }));

const NOW = new Date(2026, 9, 9, 12).getTime();

async function storeWith(...entries: Array<Partial<Parameters<AgentWalletStore['add']>[0]>>) {
  const store = new AgentWalletStore(4, memoryStorage());
  await store.setEnabled(true);
  for (const e of entries) {
    await store.add({ kind: 'spend', amountSats: 400, feeSats: 2, status: 'pending', service: 'api.example.com', at: NOW - 60_000, ...e } as any);
  }
  return store;
}

describe('reconcilePending', () => {
  it('marks settled payments paid with their fee and failed ones failed', async () => {
    const store = await storeWith({ paymentId: 'ok', expiresAt: NOW + 600_000 }, { paymentId: 'bad', expiresAt: NOW + 600_000 });
    const wallet = { paymentStatus: jest.fn(async ({ id }: any) => (id === 'ok' ? { status: 'confirmed' as const, feeSats: 1 } : { status: 'failed' as const })) };
    expect(await reconcilePending(store, wallet, NOW)).toBe(2);
    const byId = Object.fromEntries((await store.entries()).map((e) => [e.paymentId, e]));
    expect(byId.ok).toMatchObject({ status: 'paid', feeSats: 1 });
    expect(byId.bad).toMatchObject({ status: 'failed', feeSats: 0 });
    expect(await store.totals(NOW)).toEqual({ todaySats: 401, monthSats: 401 });
  });

  it('fails an unsettled payment once its invoice has expired, so it stops counting', async () => {
    const store = await storeWith({ invoice: 'lnbc1a', expiresAt: NOW - 1 }, { invoice: 'lnbc1b', expiresAt: NOW - 1 }, { invoice: 'lnbc1c', expiresAt: NOW + 60_000 });
    const wallet = { paymentStatus: jest.fn(async ({ invoice }: any) => (invoice === 'lnbc1a' ? { status: 'pending' as const, id: 'x' } : { status: 'not_found' as const })) };
    await reconcilePending(store, wallet, NOW);
    const byInvoice = Object.fromEntries((await store.entries()).map((e) => [e.invoice, e.status]));
    expect(byInvoice).toEqual({ lnbc1a: 'failed', lnbc1b: 'failed', lnbc1c: 'pending' });
    expect(await store.totals(NOW)).toEqual({ todaySats: 402, monthSats: 402 });
  });

  it('keeps counting a payment whose status could not be looked up, even after expiry', async () => {
    const store = await storeWith({ paymentId: 'p', expiresAt: NOW - 1 }, { expiresAt: NOW - 1 });
    const wallet = { paymentStatus: jest.fn(async () => { throw new Error('offline'); }) };
    expect(await reconcilePending(store, wallet, NOW)).toBe(0);
    expect((await store.entries()).every((e) => e.status === 'pending')).toBe(true);
    expect(wallet.paymentStatus).toHaveBeenCalledTimes(1);
    expect(await store.totals(NOW)).toEqual({ todaySats: 804, monthSats: 804 });
  });

  it('remembers the Spark id it found by invoice', async () => {
    const store = await storeWith({ invoice: 'lnbc1z', expiresAt: NOW + 60_000 });
    await reconcilePending(store, { paymentStatus: async () => ({ status: 'pending' as const, id: 'Spark:9' }) }, NOW);
    expect((await store.entries())[0]).toMatchObject({ status: 'pending', paymentId: 'Spark:9' });
  });

  it('never throws from the background helper', async () => {
    const damaged = new AgentWalletStore(4, memoryStorage({ 'agentWallet:log:4': '{}' }));
    await expect(reconcileAgentWallet(damaged, { paymentStatus: async () => ({ status: 'pending' as const }) })).resolves.toBe(0);
  });
});

describe('payments reconcile before deciding', () => {
  const PREIMAGE = '09'.repeat(32);
  const HASH = bytesToHex(sha256(Uint8Array.from(Buffer.from(PREIMAGE, 'hex'))));
  const T0 = Math.floor(NOW / 1000);
  const invoice = (sats: number, expiry = 600) => makeInvoice({ sats, paymentHash: HASH, timestamp: T0, expiry });

  function wallet(status: AgentPayWallet['paymentStatus'], payStatus: 'pending' | 'confirmed' = 'confirmed'): AgentPayWallet & { payInvoice: jest.Mock } {
    return {
      network: 'mainnet',
      balanceSats: async () => 100_000,
      quoteLightningFee: async () => 0,
      payInvoice: jest.fn(async () => ({ id: 'SparkLightningSendRequest:1', preimage: payStatus === 'confirmed' ? PREIMAGE : undefined, feeSats: 0, status: payStatus })),
      paymentStatus: status,
    };
  }

  it('an unsettled payment past its expiry no longer blocks the daily limit', async () => {
    const store = new AgentWalletStore(5, memoryStorage());
    await store.setEnabled(true);
    await store.savePolicy({ ...DEFAULT_POLICY, perPaymentSats: 900, dailySats: 1000, autoApproveSats: 900, allowedServices: ['api.example.com'] });
    let t = NOW + 1000;
    const stuck = wallet(async () => ({ status: 'pending' }), 'pending');
    expect(await payFromAgentWallet({ invoice: invoice(800, 120), service: 'api.example.com', reason: 't' }, { store, wallet: stuck, now: () => t })).toMatchObject({ code: 'payment_pending' });
    expect((await store.entries())[0]).toMatchObject({ status: 'pending', paymentId: 'SparkLightningSendRequest:1', expiresAt: (T0 + 120) * 1000 });

    const later = makeInvoice({ sats: 800, paymentHash: HASH, timestamp: T0 + 60, expiry: 600 });
    expect(await payFromAgentWallet({ invoice: later, service: 'api.example.com', reason: 't' }, { store, wallet: stuck, now: () => t })).toMatchObject({ code: 'daily_limit' });

    t = NOW + 200_000;
    const ok = wallet(async () => ({ status: 'pending' }));
    expect(await payFromAgentWallet({ invoice: later, service: 'api.example.com', reason: 't' }, { store, wallet: ok, now: () => t })).toMatchObject({ ok: true });
    expect((await store.entries()).map((e) => e.status)).toEqual(['paid', 'refused', 'failed']);
  });

  it('a lookup error keeps the old payment counted and the new one refused', async () => {
    const store = new AgentWalletStore(6, memoryStorage());
    await store.setEnabled(true);
    await store.savePolicy({ ...DEFAULT_POLICY, perPaymentSats: 900, dailySats: 1000, autoApproveSats: 900, allowedServices: ['api.example.com'] });
    await store.add({ kind: 'spend', amountSats: 800, feeSats: 0, status: 'pending', service: 'api.example.com', paymentId: 'x', expiresAt: NOW - 1, at: NOW - 5000 });
    const w = wallet(async () => { throw new Error('offline'); });
    expect(await payFromAgentWallet({ invoice: invoice(800), service: 'api.example.com', reason: 't' }, { store, wallet: w, now: () => NOW + 1000 })).toMatchObject({ code: 'daily_limit' });
    expect(w.payInvoice).not.toHaveBeenCalled();
  });
});

describe('Spark send lookup', () => {
  it('reads settlement from a send request', () => {
    expect(readSendRequest({ id: 'a', status: 'TRANSFER_COMPLETED', fee: { originalValue: 3000, originalUnit: 'MILLISATOSHI' } })).toEqual({ status: 'confirmed', id: 'a', feeSats: 3 });
    expect(readSendRequest({ status: 'LIGHTNING_PAYMENT_FAILED' })).toEqual({ status: 'failed', id: undefined });
    expect(readSendRequest({ status: 'LIGHTNING_PAYMENT_INITIATED' }).status).toBe('pending');
    expect(readSendRequest({ paymentPreimage: 'ff' }).status).toBe('confirmed');
  });

  it('looks up by id, and by invoice across pages', async () => {
    const wallet = {
      getLightningSendRequest: jest.fn(async (id: string) => (id === '1' ? { id: 'S:1', status: 'TRANSFER_COMPLETED' } : null)),
      getUserRequests: jest.fn(async ({ after }: any) => (after
        ? { entities: [{ id: 'S:2', encodedInvoice: 'LNBC1TARGET', status: 'LIGHTNING_PAYMENT_FAILED' }], pageInfo: { hasNextPage: false } }
        : { entities: [{ id: 'S:3', encodedInvoice: 'lnbc1other' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } })),
    };
    expect(await lookupSparkSend(wallet, { id: 'SparkLightningSendRequest:1' })).toMatchObject({ status: 'confirmed' });
    await expect(lookupSparkSend(wallet, { id: 'missing' })).rejects.toThrow();
    expect(await lookupSparkSend(wallet, { invoice: 'lnbc1target' })).toEqual({ status: 'failed', id: 'S:2' });
    expect(await lookupSparkSend({ getUserRequests: async () => ({ entities: [], pageInfo: { hasNextPage: false } }) }, { invoice: 'lnbc1x' })).toEqual({ status: 'not_found' });
    await expect(lookupSparkSend({}, { invoice: 'lnbc1x' })).rejects.toThrow();
    await expect(lookupSparkSend({ getUserRequests: async () => ({ entities: [], pageInfo: { hasNextPage: true, endCursor: 'c' } }) }, { invoice: 'lnbc1x' })).rejects.toThrow();
  });
});
