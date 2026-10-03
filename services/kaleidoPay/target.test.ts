jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { encodeOffer } from '@universal-bolt12/universal-code';
import { decodeTarget } from './target';
import { planRoutes, previewTarget, previewInput, registerKaleidoPayAccount } from './index';

// BOLT11 spec example invoice (mainnet, no amount).
const SPEC_INVOICE = 'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

test('decodes every kind of request the wallet can pay', () => {
  expect(decodeTarget(SPEC_INVOICE)).toMatchObject({ kind: 'bolt11', invoice: SPEC_INVOICE, networks: ['mainnet'] });
  expect(decodeTarget(`lightning:${SPEC_INVOICE}`)).toMatchObject({ kind: 'bolt11' });
  expect(decodeTarget('satoshi@example.com')).toMatchObject({ kind: 'lnurl', lnurl: 'satoshi@example.com' });
  expect(decodeTarget(ADDRESS)).toMatchObject({ kind: 'bitcoin', address: ADDRESS, networks: ['mainnet'] });
  expect(decodeTarget('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toMatchObject({ kind: 'bitcoin', networks: ['signet', 'mutinynet', 'testnet'] });
  expect(decodeTarget('sp1' + 'q'.repeat(40))).toMatchObject({ kind: 'spark', networks: ['mainnet'] });
  expect(decodeTarget('tark1' + 'q'.repeat(40))).toMatchObject({ kind: 'ark', arkAddress: 'tark1' + 'q'.repeat(40) });
  expect(decodeTarget('lq1' + 'q'.repeat(40))).toMatchObject({ kind: 'liquid', networks: ['mainnet'] });
  expect(decodeTarget('rgb:abc/def')).toMatchObject({ kind: 'rgb', rgbInvoice: 'rgb:abc/def' });
  const offer = encodeOffer([{ type: 10n, value: new TextEncoder().encode('Shop') }]);
  expect(decodeTarget(offer)).toMatchObject({ kind: 'offer', offer, networks: ['mainnet'] });
  expect(() => decodeTarget('hello')).toThrow("isn't something");
  expect(() => decodeTarget('bc1qar0srrr7xfkvy5l643lydnw9re59gtzz')).toThrow();
});

test('a BIP21 with a Lightning invoice keeps both legs, Lightning first', () => {
  const t = decodeTarget(`bitcoin:${ADDRESS}?amount=0.00001&lightning=${SPEC_INVOICE}`);
  expect(t).toMatchObject({ kind: 'bitcoin', address: ADDRESS, invoice: SPEC_INVOICE, amountSat: 1000 });
  expect(previewTarget(t, undefined, 'r').request.acceptedRails).toEqual(['ln', 'btc']);
});

test('accounts on any matching network are offered, each on its own chain', () => {
  const ln = (id: string, network: any) => registerKaleidoPayAccount({ source: { id, rail: 'ln', network }, swaps: [], quote: jest.fn() as any });
  const offs = [ln('main-ln', 'mainnet'), ln('signet-ln', 'signet'), ln('mutiny-ln', 'mutinynet')];
  try {
    const main = previewTarget(decodeTarget(SPEC_INVOICE), 1000, 'r1');
    expect(main.plan.status === 'ready' && [main.plan.route, ...main.plan.alternatives].map(r => r.sourceId)).toEqual(['main-ln']);
    const test = previewTarget({ kind: 'bolt11', raw: 'lntbs1', invoice: 'lntbs1', networks: ['signet', 'mutinynet', 'testnet'] }, 1000, 'r2');
    expect(test.plan.status === 'ready' && [test.plan.route, ...test.plan.alternatives].map(r => [r.sourceId, r.to])).toEqual([['signet-ln', 'ln:signet'], ['mutiny-ln', 'ln:mutinynet']]);
  } finally { offs.forEach(o => o()); }
});

test('swaps are planned on the account\'s own network', () => {
  const plan = planRoutes(
    { id: 'r', network: 'signet', networks: ['signet'], amountSat: 1000, acceptedRails: ['ln'] },
    [{ id: 'arkade', rail: 'ark', network: 'signet' }],
    [{ id: 'intents', from: 'ark', to: 'ln', network: 'signet' }],
  );
  expect(plan).toMatchObject({ status: 'ready', route: { kind: 'swap', sourceId: 'arkade', from: 'ark:signet', to: 'ln:signet', providerId: 'intents' } });
});

test('a Lightning address is resolved for the amount and must return exactly that amount', async () => {
  const lnurl = require('../../utils/lnurl');
  const spy = jest.spyOn(lnurl, 'resolveLightningAddressToInvoice').mockResolvedValue(SPEC_INVOICE);
  try {
    await expect(previewInput('satoshi@example.com', 1000, 'r3')).rejects.toThrow('different amount');
    expect(spy).toHaveBeenCalledWith('satoshi@example.com', 1000);
    await expect(previewInput('satoshi@example.com', undefined, 'r4')).rejects.toThrow('Enter an amount');
  } finally { spy.mockRestore(); }
});
