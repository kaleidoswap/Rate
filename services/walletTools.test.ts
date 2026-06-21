// services/walletTools.test.ts
//
// Tests for the money-moving binding: the canonical @kaleidorg/mind wallet
// contract bound to the WDK adapters. This is the layer the agent uses to
// actually read balances and send sats, so the routing, contact resolution,
// and guardrails are exercised against a mocked protocolManager.

import { buildWalletToolSource } from './walletTools';
import { protocolManager } from './protocols';
import { getStore } from '../store/storeProvider';
import NostrService from './NostrService';
import { resolveLightningAddressToInvoice } from '../utils/lnurl';

jest.mock('./protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn() },
}));
jest.mock('../store/storeProvider', () => ({ getStore: jest.fn() }));
jest.mock('../store/slices/walletSlice', () => ({
  fetchBitcoinPrice: jest.fn(() => ({ type: 'wallet/fetchBitcoinPrice' })),
}));
jest.mock('./NostrService', () => ({
  __esModule: true,
  default: { getInstance: jest.fn() },
}));
jest.mock('../utils/lnurl', () => ({ resolveLightningAddressToInvoice: jest.fn() }));

const mockedManager = protocolManager as jest.Mocked<typeof protocolManager>;
const mockedGetStore = getStore as jest.Mock;
const mockedNostr = NostrService as jest.Mocked<typeof NostrService>;
const mockedResolveLn = resolveLightningAddressToInvoice as jest.Mock;

// ── Test doubles ──────────────────────────────────────────────────────

interface MockAdapter {
  isConnected: jest.Mock;
  getBtcBalance: jest.Mock;
  listAssets: jest.Mock;
  getReceiveAddress: jest.Mock;
  createInvoice: jest.Mock;
  sendPayment: jest.Mock;
}

function makeAdapter(overrides: Partial<Record<keyof MockAdapter, unknown>> = {}): MockAdapter {
  return {
    isConnected: jest.fn(() => true),
    getBtcBalance: jest.fn(async () => ({ total: 1000 })),
    listAssets: jest.fn(async () => []),
    getReceiveAddress: jest.fn(async () => ({ address: 'tb1qmock' })),
    createInvoice: jest.fn(async () => ({ invoice: 'lnbc1mock' })),
    sendPayment: jest.fn(async () => ({ preimage: 'abc' })),
    ...(overrides as Partial<MockAdapter>),
  };
}

/** Wire which adapters are "connected" for this test. */
function setAdapters(adapters: { SPARK?: MockAdapter | null; RGB?: MockAdapter | null; ARKADE?: MockAdapter | null }) {
  (mockedManager.getAdapterIfAvailable as jest.Mock).mockImplementation(
    (proto: string) => (adapters as Record<string, MockAdapter | null | undefined>)[proto] ?? null,
  );
}

function setStore({
  price = 0,
  contacts = [] as any[],
  nostrContacts = [] as any[],
  dispatch = jest.fn(),
} = {}) {
  mockedGetStore.mockReturnValue({
    getState: () => ({
      wallet: { btcPriceUSD: price },
      contacts: { contacts },
      nostr: { contacts: nostrContacts },
    }),
    dispatch,
  });
  return { dispatch };
}

const source = () => buildWalletToolSource();

beforeEach(() => {
  jest.clearAllMocks();
  setAdapters({});
  setStore();
});

// ── Safety contract ───────────────────────────────────────────────────

describe('safety flags (the structural confirm gate)', () => {
  it('marks every spend tool requiresConfirmation and leaves reads ungated', () => {
    const tools = source().listTools() as Array<{ name: string; requiresConfirmation?: boolean }>;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    for (const spend of ['send_payment', 'rln_pay_invoice', 'rln_send_asset']) {
      expect(byName[spend]).toBeDefined();
      expect(byName[spend].requiresConfirmation).toBe(true);
    }
    for (const read of ['get_balances', 'get_price', 'resolve_contact', 'fiat_to_sats']) {
      expect(byName[read]).toBeDefined();
      expect(byName[read].requiresConfirmation).toBeFalsy();
    }
  });
});

// ── Reads ─────────────────────────────────────────────────────────────

describe('get_balances', () => {
  it('aggregates BTC across connected layers and skips disconnected ones', async () => {
    const spark = makeAdapter({ getBtcBalance: jest.fn(async () => ({ total: 1500 })) });
    const rln = makeAdapter({
      getBtcBalance: jest.fn(async () => ({ total: 2500 })),
      listAssets: jest.fn(async () => [{ ticker: 'USDT', balance: 10 }, { ticker: 'BTC' }]),
    });
    setAdapters({ SPARK: spark, RGB: rln, ARKADE: null });

    const r: any = await source().execute('get_balances', {});

    expect(r.total_sats).toBe(4000);
    expect(r.layers).toHaveLength(2);
    const rlnLayer = r.layers.find((l: any) => l.layer === 'rln');
    // BTC pseudo-asset is filtered out of the asset list.
    expect(rlnLayer.assets).toEqual([{ ticker: 'USDT', balance: 10 }]);
  });

  it('honors the layer filter', async () => {
    const spark = makeAdapter({ getBtcBalance: jest.fn(async () => ({ total: 1500 })) });
    const rln = makeAdapter();
    setAdapters({ SPARK: spark, RGB: rln });

    const r: any = await source().execute('get_balances', { layer: 'spark' });

    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].layer).toBe('spark');
    expect(rln.getBtcBalance).not.toHaveBeenCalled();
  });

  it('throws a friendly error when no wallet is connected', async () => {
    setAdapters({});
    await expect(source().execute('get_balances', {})).rejects.toThrow('No wallet is connected yet.');
  });
});

describe('get_price / fiat_to_sats', () => {
  it('returns the cached BTC price', async () => {
    setStore({ price: 70000 });
    const r: any = await source().execute('get_price', {});
    expect(r.price_usd).toBe(70000);
  });

  it('fetches the price on demand when the cache is empty', async () => {
    // First read 0, then 65000 after the dispatched fetch "lands".
    let price = 0;
    const dispatch = jest.fn(() => {
      price = 65000;
    });
    mockedGetStore.mockReturnValue({
      getState: () => ({ wallet: { btcPriceUSD: price }, contacts: { contacts: [] }, nostr: { contacts: [] } }),
      dispatch,
    });

    const r: any = await source().execute('get_price', {});
    expect(dispatch).toHaveBeenCalled();
    expect(r.price_usd).toBe(65000);
  });

  it('errors when the price is unavailable even after a fetch', async () => {
    setStore({ price: 0 });
    await expect(source().execute('get_price', {})).rejects.toThrow('Price is not available right now.');
  });

  it('converts fiat to sats at the cached price', async () => {
    setStore({ price: 100000 });
    const r: any = await source().execute('fiat_to_sats', { amount: 50, currency: 'USD' });
    // 50 / 100000 BTC = 0.0005 BTC = 50,000 sats
    expect(r.sats).toBe(50000);
    expect(r.note).toBeUndefined();
  });

  it('flags non-USD conversions as approximate', async () => {
    setStore({ price: 100000 });
    const r: any = await source().execute('fiat_to_sats', { amount: 10, currency: 'EUR' });
    expect(r.note).toMatch(/EUR/);
  });
});

// ── Contact resolution ────────────────────────────────────────────────

describe('resolve_contact', () => {
  it('prefers an exact name match over partial matches', async () => {
    setStore({
      contacts: [
        { name: 'Alice', lightning_address: 'alice@ln.tips' },
        { name: 'Alice Cooper', lightning_address: 'cooper@ln.tips' },
      ],
    });
    const r: any = await source().execute('resolve_contact', { name: 'alice' });
    expect(r.ln_address).toBe('alice@ln.tips');
  });

  it('refuses to guess between multiple matching contacts', async () => {
    setStore({
      contacts: [
        { name: 'Bob Marley', lightning_address: 'marley@ln.tips' },
        { name: 'Bob Dylan', lightning_address: 'dylan@ln.tips' },
      ],
    });
    await expect(source().execute('resolve_contact', { name: 'bob' })).rejects.toThrow(/which one/);
  });

  it('errors clearly when no contact matches', async () => {
    setStore({ contacts: [] });
    await expect(source().execute('resolve_contact', { name: 'nobody' })).rejects.toThrow('No contact named "nobody".');
  });

  it("fetches a Nostr contact's Lightning address on demand when not cached", async () => {
    setStore({
      nostrContacts: [{ pubkey: 'pk1', npub: 'npub1x', profile: { display_name: 'Carol' } }],
    });
    (mockedNostr.getInstance as jest.Mock).mockReturnValue({
      getUserInfo: jest.fn(async () => ({ profile: { lud16: 'carol@ln.tips' } })),
    });

    const r: any = await source().execute('resolve_contact', { name: 'carol' });
    expect(r.ln_address).toBe('carol@ln.tips');
  });

  it('errors when the contact has no Lightning address anywhere', async () => {
    setStore({ contacts: [{ name: 'Dave' }] });
    await expect(source().execute('resolve_contact', { name: 'dave' })).rejects.toThrow(
      `"Dave" doesn't have a Lightning address set.`,
    );
  });

  it('matches a contact despite trailing punctuation ("Walter?")', async () => {
    setStore({ contacts: [{ name: 'Walter', lightning_address: 'walter@ln.tips' }] });
    const r: any = await source().execute('resolve_contact', { name: 'Walter?' });
    expect(r.ln_address).toBe('walter@ln.tips');
  });

  it('lists the real contacts when the named one is missing (so the agent can recover)', async () => {
    setStore({ contacts: [{ name: 'Walter' }, { name: 'Vincenzo' }] });
    await expect(source().execute('send_payment', { to: 'send', amount_sats: 1 })).rejects.toThrow(
      'Your contacts are: Walter, Vincenzo.',
    );
  });

  it('list_contacts returns names + Lightning availability so the agent can ask', async () => {
    setStore({ contacts: [{ name: 'Alice', lightning_address: 'alice@ln.tips' }, { name: 'Bob' }] });
    const r: any = await source().execute('list_contacts', {});
    expect(r.count).toBe(2);
    expect(r.contacts).toEqual([
      { name: 'Alice', has_lightning: true, source: 'local' },
      { name: 'Bob', has_lightning: false, source: 'local' },
    ]);
  });
});

// ── Spend routing ─────────────────────────────────────────────────────

describe('send_payment', () => {
  it('pays a BOLT11 invoice on Spark when connected', async () => {
    const spark = makeAdapter();
    setAdapters({ SPARK: spark });

    await source().execute('send_payment', { to: 'lnbc500n1pmock' });
    expect(spark.sendPayment).toHaveBeenCalledWith({ invoice: 'lnbc500n1pmock' });
  });

  it('falls back to RLN when Spark is not connected', async () => {
    const rln = makeAdapter();
    setAdapters({ SPARK: null, RGB: rln });

    await source().execute('send_payment', { to: 'lnbc500n1pmock' });
    expect(rln.sendPayment).toHaveBeenCalledWith({ invoice: 'lnbc500n1pmock' });
  });

  it('resolves a contact name → Lightning address → BOLT11 before paying', async () => {
    const spark = makeAdapter();
    setAdapters({ SPARK: spark });
    setStore({ contacts: [{ name: 'Alice', lightning_address: 'alice@ln.tips' }] });
    mockedResolveLn.mockResolvedValue('lnbc21u1presolved');

    await source().execute('send_payment', { to: 'Alice', amount_sats: 2100 });

    expect(mockedResolveLn).toHaveBeenCalledWith('alice@ln.tips', 2100);
    expect(spark.sendPayment).toHaveBeenCalledWith({ invoice: 'lnbc21u1presolved', amountSats: 2100 });
  });

  it('requires an amount to pay a Lightning address', async () => {
    setAdapters({ SPARK: makeAdapter() });
    await expect(source().execute('send_payment', { to: 'alice@ln.tips' })).rejects.toThrow(
      'I need an amount in sats to pay a Lightning address.',
    );
  });

  it('rejects on-chain addresses (not supported from the assistant)', async () => {
    setAdapters({ SPARK: makeAdapter() });
    await expect(
      source().execute('send_payment', { to: 'bc1qsomeaddress', amount_sats: 1000 }),
    ).rejects.toThrow(/on-chain sends/i);
  });

  it('errors on a contact with no payable address instead of guessing', async () => {
    setAdapters({ SPARK: makeAdapter() });
    setStore({ contacts: [{ name: 'Dave' }] });
    await expect(source().execute('send_payment', { to: 'Dave', amount_sats: 100 })).rejects.toThrow(
      `"Dave" doesn't have a Lightning address set.`,
    );
  });

  it('requires a destination', async () => {
    setAdapters({ SPARK: makeAdapter() });
    await expect(source().execute('send_payment', { to: '' })).rejects.toThrow(
      'A destination (invoice, address, or contact) is required.',
    );
  });
});

describe('rln_send_asset', () => {
  it('sends to an RGB invoice via the RLN adapter', async () => {
    const rln = makeAdapter();
    setAdapters({ RGB: rln });

    await source().execute('rln_send_asset', { asset: 'USDT', amount: 5, to: 'rgb:utxob1mock' });
    expect(rln.sendPayment).toHaveBeenCalledWith({ invoice: 'rgb:utxob1mock' });
  });

  it('guides the user to an RGB invoice instead of mis-sending to a plain address', async () => {
    setAdapters({ RGB: makeAdapter() });
    await expect(
      source().execute('rln_send_asset', { asset: 'USDT', amount: 5, to: 'alice@ln.tips' }),
    ).rejects.toThrow(/ask them for an RGB invoice/);
  });

  it('errors when the RLN wallet is not connected', async () => {
    setAdapters({ RGB: null });
    await expect(
      source().execute('rln_send_asset', { asset: 'USDT', amount: 5, to: 'rgb:utxob1mock' }),
    ).rejects.toThrow("Your RLN wallet isn't connected yet.");
  });
});

// ── Invoice routing + shape normalization ─────────────────────────────

describe('create_invoice', () => {
  it('routes RGB assets to the RLN node', async () => {
    const rln = makeAdapter();
    setAdapters({ RGB: rln });

    await source().execute('create_invoice', { asset: 'USDT', amount: 10 });
    expect(rln.createInvoice).toHaveBeenCalledWith({ asset: 'USDT', assetAmount: 10 });
  });

  it('prefers RLN for BTC (a real bolt11) over Spark when both are connected', async () => {
    const spark = makeAdapter();
    const rln = makeAdapter();
    setAdapters({ SPARK: spark, RGB: rln });

    await source().execute('create_invoice', { asset: 'BTC', amount: 5000 });
    expect(rln.createInvoice).toHaveBeenCalledWith({ amount: 5000, layer: 'BTC_LN' });
    expect(spark.createInvoice).not.toHaveBeenCalled();
  });

  it('honors an explicitly requested layer', async () => {
    const spark = makeAdapter();
    const rln = makeAdapter();
    setAdapters({ SPARK: spark, RGB: rln });

    await source().execute('create_invoice', { asset: 'BTC', amount: 5000, layer: 'spark' });
    expect(spark.createInvoice).toHaveBeenCalledWith({ amount: 5000, layer: 'BTC_LN' });
    expect(rln.createInvoice).not.toHaveBeenCalled();
  });

  it.each([
    [{ paymentRequest: 'lnbc1pr' }, 'lnbc1pr'],
    [{ bolt11: 'lnbc1b11' }, 'lnbc1b11'],
    ['lnbc1string', 'lnbc1string'],
  ])('normalizes adapter invoice shape %j to { invoice }', async (raw, expected) => {
    const rln = makeAdapter({ createInvoice: jest.fn(async () => raw) });
    setAdapters({ RGB: rln });

    const r: any = await source().execute('create_invoice', { asset: 'BTC', amount: 100 });
    expect(r.invoice).toBe(expected);
  });
});
