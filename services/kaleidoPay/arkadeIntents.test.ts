const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStorage.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockStorage.set(k, v); }),
  getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
}));

const HASH = 'ab'.repeat(32);
jest.mock('light-bolt11-decoder', () => ({
  decode: () => ({
    sections: [
      { name: 'amount', value: '10000000' },
      { name: 'timestamp', value: Math.floor(Date.now() / 1000) },
      { name: 'payment_hash', value: 'ab'.repeat(32) },
    ],
    expiry: 3600,
  }),
}));

// Venue fake: records go to the store it was given, like the real one.
const mockVenue = {
  instances: [] as any[],
  binding: { from: 10_100 },
  prepare: jest.fn(),
  reconcile: jest.fn(),
  receive: jest.fn(),
  claim: jest.fn(),
};
jest.mock('@kaleidorg/swap-sdk/arkade', () => ({
  ArkadeIntentsVenue: class {
    opts: any;
    constructor(opts: any) { this.opts = opts; mockVenue.instances.push(this); }
    async prepareLightningSend(params: any) {
      mockVenue.prepare(params, this.opts.transport);
      const id = `rfq-${mockVenue.instances.length}`;
      const record = { id, route: 'arkade:BTC->lightning:BTC', phase: 'prepared', quote: { valid_until: Math.floor(Date.now() / 1000) + 60 } };
      await this.opts.store.put(record);
      return { record, address: 'tark1lockup', fundAmountSats: mockVenue.binding.from,
        summary: { fromAmountSats: mockVenue.binding.from, toAmountSats: params.invoice.amountSats, feeSats: mockVenue.binding.from - params.invoice.amountSats, validUntil: Math.floor(Date.now() / 1000) + 60 } };
    }
    async notifyFunded(id: string, txid: string) {
      const r = await this.opts.store.get(id);
      await this.opts.store.put({ ...r, phase: 'funded', fundingTxid: txid });
      return r;
    }
    async reconcile() { return mockVenue.reconcile(this.opts.store); }
    async prepareLightningReceive(params: any) {
      const fee = mockVenue.receive(params, this.opts.transport);
      const id = `rfq-recv-${mockVenue.instances.length}`;
      const record = { id, route: 'lightning:BTC->arkade:BTC', phase: 'prepared' };
      await this.opts.store.put(record);
      return { record, invoice: 'lntbs1hold', payAmountSats: params.amountSats + fee, invoiceExpiresAt: 2_000_000_000,
        summary: { fromAmountSats: params.amountSats + fee, toAmountSats: params.amountSats } };
    }
    async claimReceive(id: string, options: any) { mockVenue.claim(id, options); return { id, phase: 'settled' }; }
  },
}));
const mockHttpTransport = jest.fn((root: string) => ({ kind: 'http', root, close: jest.fn(async () => {}) }));
const mockMarkets: any[] = [];
jest.mock('@arkade-os/swap', () => ({
  httpTransport: (root: string) => mockHttpTransport(root),
  discoverMarkets: jest.fn(async () => mockMarkets),
}));
const mockNostrTransport = jest.fn((o: any) => ({ kind: 'nostr', ...o, close: jest.fn(async () => {}) }));
jest.mock('@arkade-os/swap/nostr', () => ({ nostrRfqTransport: (o: any) => mockNostrTransport(o) }));

import {
  claimArkadeLightningReceive, createArkadeLightningReceive, estimateLightningReceive,
  createArkadeIntentsSwap, createAsyncStorageArkadeSwapStore, estimateLightningSend, makerCorridorRoot,
  recoverArkadeIntentSwaps, registryNetwork, resultOfPhase,
} from './arkadeIntents';
import { createArkadeAccount } from './arkadePay';
import { executePaymentOffer, previewTarget, quotePaymentOffers, registerKaleidoPayAccount, checkPaymentStatus, PaymentNotSentError } from './index';

const SOLVER = '3f'.repeat(32);
const MAKER = '21'.repeat(32);
const lnMarket = (o: any = {}) => ({
  pair: 'BTC/lightning:BTC', base_asset: { id: 'btc' }, quote_asset: { id: 'btc' }, quote_corridor: 'lightning',
  fee_bps: 30, min_base_amount: '1000', max_base_amount: '50000', min_quote_amount: '1000', max_quote_amount: '25000', ...o,
});
const makerCard = { discovery_pubkey: MAKER, markets: [lnMarket({ fee_bps: 100, min_base_amount: '10000', max_base_amount: '685164', min_quote_amount: '10000', max_quote_amount: '951232' })] };
const fetchImpl = jest.fn(async (url: string) => ({ ok: true, json: async () => (url.endsWith('/v1/card') ? makerCard : {}) })) as any;

const wallet = { sendBitcoin: jest.fn(async () => 'fundtx'), arkProvider: { serverUrl: 'https://mutinynet.arkade.sh' } };
const adapter = {
  arkInfo: { network: 'mutinynet', signerPubkey: '02' + '11'.repeat(32), fees: { txFeeRate: '0', intentFee: {} } },
  rawWallet: wallet,
  sendPayment: jest.fn(),
  getBtcBalance: jest.fn(async () => ({ confirmed: 100_000 })),
};
const invoiceTarget = () => ({ kind: 'bolt11' as const, raw: 'lntb100u1x', invoice: 'lntb100u1x', networks: ['mutinynet' as const], amountSat: 10_000 });

beforeEach(() => {
  mockStorage.clear();
  mockMarkets.splice(0, mockMarkets.length,
    { ...lnMarket(), solver: 'ln-solver-mutinynet', discovery_pubkey: SOLVER, transports: { nostr: { relays: ['wss://nostr.arkade.sh'] } } },
    { ...lnMarket({ fee_bps: 1 }), solver: 'kaleidoswap', discovery_pubkey: MAKER, transports: { nostr: { relays: ['wss://relay.kaleidoswap.com'] } } },
    { ...lnMarket({ quote_corridor: 'onchain' }), solver: 'x', discovery_pubkey: 'cd'.repeat(32), transports: { nostr: { relays: ['wss://r'] } } },
  );
  mockVenue.instances.length = 0;
  mockVenue.binding.from = 10_100;
  mockVenue.prepare.mockClear();
  mockVenue.reconcile.mockReset();
  wallet.sendBitcoin.mockClear();
  mockHttpTransport.mockClear();
  mockNostrTransport.mockClear();
});

function connect() {
  const account = createArkadeAccount(adapter as any, 'mutinynet', { makerUrl: 'https://maker.signet.kaleidoswap.com/v2/', fetchImpl });
  return { account, off: registerKaleidoPayAccount(account) };
}

test('estimates', () => {
  expect(estimateLightningSend(lnMarket() as any, 10_000)).toEqual({ feeSat: 31 });
  expect(estimateLightningSend(lnMarket({ fee_flat: '5' }) as any, 10_000)).toEqual({ feeSat: 36 });
  expect(estimateLightningSend(lnMarket() as any, 500)).toEqual({ unavailable: expect.stringContaining('minimum') });
  expect(estimateLightningSend(lnMarket() as any, 30_000)).toEqual({ unavailable: expect.stringContaining('maximum') });
  expect(estimateLightningSend(lnMarket({ quote_corridor: 'onchain' }) as any, 10_000)).toHaveProperty('unavailable');
  expect(makerCorridorRoot('https://maker.signet.kaleidoswap.com/v2/')).toBe('https://maker.signet.kaleidoswap.com');
  expect(makerCorridorRoot('https://maker.example.com')).toBe('https://maker.example.com');
  expect(makerCorridorRoot('https://maker.example.com/api')).toBeNull();
  expect(makerCorridorRoot('https://maker.example.com/v2?x=1')).toBeNull();
  expect(registryNetwork('mutinynet', 'signet')).toBe('mutinynet');
  expect(registryNetwork(undefined, 'mainnet')).toBe('bitcoin');
  expect(resultOfPhase('settled').status).toBe('completed');
  expect(resultOfPhase('refunded').status).toBe('failed');
  expect(resultOfPhase('needs_recovery').status).toBe('unknown');
  expect(resultOfPhase('funded').status).toBe('pending');
});

test('reviewing lists every provider with card estimates and never sends an RFQ', async () => {
  const { off } = connect();
  try {
    const preview = previewTarget(invoiceTarget(), undefined, 'r1');
    expect(preview.plan.status).toBe('ready');
    const offers = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'arkade');
    expect(offers.map(o => o.provider)).toEqual(['KaleidoSwap', 'ln-solver-mutinynet']);
    expect(offers[0].id.endsWith(':kaleidoswap')).toBe(true); // the maker's registry entry is not offered twice
    const [maker, solver] = offers;
    expect(maker.quote).toMatchObject({ recipientSat: 10_000, feeSat: 102, totalSat: 10_102 });
    expect(solver.quote).toMatchObject({ feeSat: 31, totalSat: 10_031 });
    expect(solver.providerDetail).toContain('estimated');
    expect(mockVenue.prepare).not.toHaveBeenCalled();
    expect(mockHttpTransport).not.toHaveBeenCalled();
    expect(mockNostrTransport).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith('https://maker.signet.kaleidoswap.com/v1/card', expect.anything());
  } finally { off(); }
});

test('pays through the chosen provider only, funds the lockup and follows the swap', async () => {
  const { off } = connect();
  try {
    const preview = previewTarget(invoiceTarget(), undefined, 'r2');
    const offers = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'arkade');
    const maker = offers.find(o => o.id.endsWith(':kaleidoswap'))!;
    const result = await executePaymentOffer(preview, maker, 'pay-1');
    expect(result).toEqual({ status: 'pending', reference: 'rfq-1' });
    expect(mockVenue.prepare).toHaveBeenCalledTimes(1);
    expect(mockVenue.prepare.mock.calls[0][0]).toEqual({ invoice: expect.objectContaining({ paymentHash: HASH, amountSats: 10_000 }) });
    expect(mockHttpTransport).toHaveBeenCalledWith('https://maker.signet.kaleidoswap.com');
    expect(mockNostrTransport).not.toHaveBeenCalled();
    expect(wallet.sendBitcoin).toHaveBeenCalledWith({ address: 'tark1lockup', amount: 10_100 });

    mockVenue.reconcile.mockImplementation(async () => ({ pending: ['rfq-1'] }));
    expect(await checkPaymentStatus('arkade', 'pay-1')).toEqual({ status: 'pending', reference: 'rfq-1' });
    mockVenue.reconcile.mockImplementation(async (store: any) => {
      await store.put({ ...(await store.get('rfq-1')), phase: 'settled', resolvedTxid: 'claimtx' });
      return { settled: ['rfq-1'] };
    });
    expect(await checkPaymentStatus('arkade', 'pay-1')).toEqual({ status: 'completed', reference: 'claimtx' });
  } finally { off(); }
});

test('a binding quote above the approved total is refused before anything is funded', async () => {
  const { off } = connect();
  try {
    const preview = previewTarget(invoiceTarget(), undefined, 'r3');
    const solver = (await quotePaymentOffers(preview)).find(o => o.route.sourceId === 'arkade' && o.id.endsWith(SOLVER))!;
    mockVenue.binding.from = 10_200;
    await expect(executePaymentOffer(preview, solver, 'pay-2')).rejects.toBeInstanceOf(PaymentNotSentError);
    expect(mockNostrTransport).toHaveBeenCalledWith({ relays: ['wss://nostr.arkade.sh'], solverPubkey: SOLVER });
    expect(wallet.sendBitcoin).not.toHaveBeenCalled();
  } finally { off(); }
});

test('an unknown Ark transaction fee makes every provider unavailable instead of free', async () => {
  const swap = createArkadeIntentsSwap({
    sourceId: 'arkade-t4', rail: 'ark', network: 'mutinynet', wallet: () => wallet, arkServerUrl: () => 'https://a', arkNetwork: () => 'mutinynet',
    fundingFee: () => null, balance: async () => 100_000, makerUrl: null, fetchImpl,
  });
  const preview = previewTarget(invoiceTarget(), undefined, 'r4');
  const route = { kind: 'swap' as const, sourceId: 'arkade-t4', from: 'ark:mutinynet', to: 'ln:mutinynet', providerId: 'arkade-intents' };
  const options = await swap.quoteOptions(preview, route);
  expect(options.length).toBeGreaterThan(0);
  expect(options.every(o => !o.quote && o.unavailable)).toBe(true);
});

test('the AsyncStorage store lists only pending records; recovery reconciles them', async () => {
  const store = createAsyncStorageArkadeSwapStore('t-');
  await store.put({ id: 'a', phase: 'funded' } as any);
  await store.put({ id: 'b', phase: 'settled' } as any);
  expect((await store.listPending()).map(r => r.id)).toEqual(['a']);
  expect(await store.get('b')).toMatchObject({ phase: 'settled' });
  mockVenue.reconcile.mockResolvedValue({ settled: ['a'] });
  expect(await recoverArkadeIntentSwaps(wallet, 'https://a', store)).toEqual({ settled: ['a'] });
  await store.put({ id: 'a', phase: 'settled' } as any);
  mockVenue.reconcile.mockClear();
  expect(await recoverArkadeIntentSwaps(wallet, 'https://a', store)).toBeNull();
  expect(mockVenue.reconcile).not.toHaveBeenCalled();
});

describe('Lightning into Arkade', () => {
  const base = { network: 'mutinynet' as const, wallet, arkServerUrl: 'https://mutinynet.arkade.sh', arkNetwork: 'mutinynet', makerUrl: 'https://maker.signet.kaleidoswap.com', fetchImpl };

  test('estimates what the sender pays', () => {
    expect(estimateLightningReceive(lnMarket({ fee_bps: 100 }), 10_000)).toEqual({ payAmountSat: 10_102 });
    expect(estimateLightningReceive(lnMarket(), 100)).toEqual({ unavailable: "Below this provider's minimum of 1,000 sats." });
    expect(estimateLightningReceive({ ...lnMarket(), quote_asset: { id: 'usdt' } }, 10_000)).toEqual({ unavailable: 'This provider does not pay out on Arkade.' });
  });

  test('gets the invoice from KaleidoSwap first, capped near its published fee', async () => {
    mockVenue.receive.mockReset().mockReturnValue(101);
    const receive = await createArkadeLightningReceive(base, 10_000);
    expect(receive).toMatchObject({ invoice: 'lntbs1hold', amountSats: 10_000, payAmountSats: 10_101, provider: 'KaleidoSwap' });
    expect(mockVenue.receive).toHaveBeenCalledTimes(1);
    const [params, transport] = mockVenue.receive.mock.calls[0];
    expect(transport.kind).toBe('http');
    expect(params.maxPayAmountSats).toBe(10_102 + 50 + 10);
  });

  test('falls back to a registry solver when KaleidoSwap cannot quote', async () => {
    mockMarkets.splice(0, mockMarkets.length, { ...lnMarket(), solver: 'Solver A', discovery_pubkey: SOLVER, transports: { nostr: { relays: ['wss://relay.example'] } } });
    mockVenue.receive.mockReset().mockImplementationOnce(() => { throw new Error('no liquidity'); }).mockReturnValue(31);
    const receive = await createArkadeLightningReceive(base, 10_000);
    expect(receive.provider).toBe('Solver A');
    expect(mockVenue.receive.mock.calls[1][1].kind).toBe('nostr');
    mockMarkets.splice(0, mockMarkets.length);
  });

  test('refuses without an amount and explains when nobody can quote', async () => {
    await expect(createArkadeLightningReceive(base, 0)).rejects.toThrow('needs one');
    mockVenue.receive.mockReset().mockImplementation(() => { throw new Error('no liquidity'); });
    await expect(createArkadeLightningReceive(base, 10_000)).rejects.toThrow('KaleidoSwap: no liquidity');
  });

  test('claims a receive without waiting', async () => {
    mockVenue.claim.mockReset();
    await expect(claimArkadeLightningReceive(wallet, base.arkServerUrl, 'rfq-recv-1')).resolves.toBe('settled');
    expect(mockVenue.claim).toHaveBeenCalledWith('rfq-recv-1', { waitSeconds: 0 });
  });
});
