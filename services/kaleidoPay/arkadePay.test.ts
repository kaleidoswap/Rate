const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStorage.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockStorage.set(k, v); }),
  getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
}));
const mockReconcile = jest.fn(async () => ({ settled: [] }));
jest.mock('@kaleidorg/swap-sdk/arkade', () => ({
  ArkadeIntentsVenue: class { reconcile() { return mockReconcile(); } },
}));
jest.mock('@arkade-os/swap', () => ({ discoverMarkets: jest.fn(async () => []), httpTransport: jest.fn() }));
jest.mock('@arkade-os/swap/nostr', () => ({ nostrRfqTransport: jest.fn() }));

import {
  arkadeOffboardFee, arkadeOffchainFee, connectArkadePayAccounts, createArkadeAccount, createArkadeOnchainAccount, outputScriptHex,
} from './arkadePay';
import { checkPaymentStatus, executePaymentOffer, previewTarget, quotePaymentOffers, registerKaleidoPayAccount, PaymentNotSentError } from './index';
import type { PayTarget } from './index';

const SIGNER = '11'.repeat(32);
const OTHER = '22'.repeat(32);
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map(b => parseInt(b, 16)));
const OWN_ARK = 'tark1ownserveraddressxxxxxxxxxxxxxxx';
const BARK_ARK = 'tark1otherserveraddressxxxxxxxxxxxxx';
const BTC = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

function makeAdapter(fees: any = { txFeeRate: '0.5', intentFee: { onchainOutput: '200.0', offchainInput: '' } }) {
  return {
    arkInfo: { network: 'mutinynet', signerPubkey: '03' + SIGNER, fees },
    arkSdk: { ArkAddress: { decode: (a: string) => {
      if (a === OWN_ARK) return { serverPubKey: hexBytes(SIGNER) };
      if (a === BARK_ARK) return { serverPubKey: hexBytes(OTHER) };
      throw new Error('bad address');
    } } },
    rawWallet: { arkProvider: { serverUrl: 'https://mutinynet.arkade.sh' } },
    sendPayment: jest.fn(async (r: any) => ({ txid: 'arktx', paymentHash: 'arktx', amount: r.amount, status: 'confirmed', fee: 75 })),
    offboard: jest.fn(async () => ({ txid: 'committx' })),
    getBtcBalance: jest.fn(async () => ({ confirmed: 50_000 })),
  };
}
const arkTarget = (arkAddress: string): PayTarget => ({ kind: 'ark', raw: arkAddress, arkAddress, networks: ['mutinynet'] });
const btcTarget: PayTarget = { kind: 'bitcoin', raw: BTC, address: BTC, networks: ['mutinynet'] };

beforeEach(() => { mockStorage.clear(); mockReconcile.mockClear(); });

test('fees come from the server table; an unstated fee is unknown, not zero', () => {
  expect(arkadeOffchainFee(makeAdapter() as any)).toBe(75);
  expect(arkadeOffchainFee(makeAdapter({ txFeeRate: '0', intentFee: {} }) as any)).toBe(0);
  expect(arkadeOffchainFee(makeAdapter({ txFeeRate: '', intentFee: {} }) as any)).toBeNull();
  expect(arkadeOffchainFee(makeAdapter(null) as any)).toBeNull();
  expect(arkadeOffboardFee(makeAdapter() as any, 10_000)).toBe(200);
  expect(arkadeOffboardFee(makeAdapter({ txFeeRate: '0', intentFee: { offchainInput: '0.0', onchainOutput: '' } }) as any, 10_000)).toBe(0);
  // Input fees depend on coin selection; a server charging them is not quotable.
  expect(arkadeOffboardFee(makeAdapter({ txFeeRate: '0', intentFee: { offchainInput: '10.0', onchainOutput: '200' } }) as any, 10_000)).toBeNull();
  // A fee program is evaluated with the SDK estimator when it is available.
  const programmed: any = makeAdapter({ txFeeRate: '0', intentFee: { onchainOutput: 'amount * 0.01' } });
  expect(arkadeOffboardFee(programmed, 10_000, '0014aa')).toBeNull();
  programmed.arkSdk.Estimator = class { evalOnchainOutput() { return { satoshis: 150 }; } };
  expect(arkadeOffboardFee(programmed, 10_000, '0014aa')).toBe(150);
  expect(outputScriptHex(BTC, 'mutinynet')).toBe('0014751e76e8199196d454941c45d1b3a323f1433bd6');
});

test('pays an Ark address on its own server directly and keeps the receipt', async () => {
  const adapter = makeAdapter();
  const off = registerKaleidoPayAccount(createArkadeAccount(adapter as any, 'mutinynet'));
  try {
    const preview = previewTarget(arkTarget(OWN_ARK), 5_000, 'a1');
    const [offer] = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'arkade');
    expect(offer.quote).toMatchObject({ recipientSat: 5_000, feeSat: 75, totalSat: 5_075 });
    expect(await executePaymentOffer(preview, offer, 'att-1')).toEqual({ status: 'completed', reference: 'arktx' });
    expect(adapter.sendPayment).toHaveBeenCalledWith({ invoice: OWN_ARK, amount: 5_000 });
    expect(await checkPaymentStatus('arkade', 'att-1')).toEqual({ status: 'completed', reference: 'arktx' });
  } finally { off(); }
});

test('refuses an Ark address of another server so another account (Bark) can take it', async () => {
  const adapter = makeAdapter();
  const off = registerKaleidoPayAccount(createArkadeAccount(adapter as any, 'mutinynet'));
  try {
    const preview = previewTarget(arkTarget(BARK_ARK), 5_000, 'a2');
    const [offer] = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'arkade');
    expect(offer.quote).toBeUndefined();
    expect(offer.unavailable).toContain('different Ark server');
    await expect(executePaymentOffer(preview, offer, 'att-2')).rejects.toBeInstanceOf(PaymentNotSentError);
    expect(adapter.sendPayment).not.toHaveBeenCalled();
  } finally { off(); }
});

test('unknown fee or short balance makes the Ark option unavailable', async () => {
  for (const [adapter, message] of [
    [makeAdapter({ txFeeRate: '', intentFee: {} }), 'did not report'],
    [Object.assign(makeAdapter(), { getBtcBalance: async () => ({ confirmed: 100 }) }), 'Insufficient'],
  ] as const) {
    const off = registerKaleidoPayAccount(createArkadeAccount(adapter as any, 'mutinynet'));
    try {
      const [offer] = (await quotePaymentOffers(previewTarget(arkTarget(OWN_ARK), 5_000, 'a3'))).filter(o => o.route.sourceId === 'arkade');
      expect(offer.unavailable).toContain(message);
    } finally { off(); }
  }
});

test('pays a bitcoin address by offboarding amount + output fee', async () => {
  const adapter = makeAdapter();
  const off = registerKaleidoPayAccount(createArkadeOnchainAccount(adapter as any, 'mutinynet'));
  try {
    const preview = previewTarget(btcTarget, 20_000, 'b1');
    const [offer] = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'arkade-onchain');
    expect(offer.quote).toMatchObject({ recipientSat: 20_000, feeSat: 200, totalSat: 20_200 });
    expect(await executePaymentOffer(preview, offer, 'att-3')).toEqual({ status: 'completed', reference: 'committx' });
    expect(adapter.offboard).toHaveBeenCalledWith(BTC, 20_200);
    expect(await checkPaymentStatus('arkade-onchain', 'att-3')).toEqual({ status: 'completed', reference: 'committx' });
  } finally { off(); }
});

test('an offboard refused during coin selection is reported as not sent', async () => {
  const adapter = makeAdapter();
  adapter.offboard.mockRejectedValueOnce(new Error('Amount is greater than total amount of vtxos after fees'));
  const off = registerKaleidoPayAccount(createArkadeOnchainAccount(adapter as any, 'mutinynet'));
  try {
    const preview = previewTarget(btcTarget, 20_000, 'b2');
    const [offer] = (await quotePaymentOffers(preview)).filter(o => o.route.sourceId === 'arkade-onchain');
    await expect(executePaymentOffer(preview, offer, 'att-4')).rejects.toBeInstanceOf(PaymentNotSentError);
  } finally { off(); }
});

test('connect registers both accounts, recovers swaps, and unregisters', async () => {
  mockStorage.set('kaleidopay-arkade-intents-record:x', JSON.stringify({ id: 'x', phase: 'funded' }));
  const off = connectArkadePayAccounts(makeAdapter() as any, 'mutinynet');
  await new Promise(r => setTimeout(r, 0));
  expect(mockReconcile).toHaveBeenCalled();
  expect(previewTarget(btcTarget, 1_000, 'c1').plan.status).toBe('ready');
  expect(previewTarget(arkTarget(OWN_ARK), 1_000, 'c2').plan.status).toBe('ready');
  off();
  expect(previewTarget(btcTarget, 1_000, 'c3').plan.status).toBe('unsupported');
});
