jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { encodeOffer, encodePaymentCode } from '@universal-bolt12/universal-code';
import { isSwappableAddress, offerAmountSat, codeNetwork, previewPayment, quotePayment, railLabel, registerKaleidoPayAccount, isKaleidoPayCode } from './index';
const offer = encodeOffer([{ type: 10n, value: new TextEncoder().encode('Coffee') }]);
const code = encodePaymentCode({ offer, amountSat: 50000 }, 'signet');

test('recognizes offer scans and keeps legacy invoices outside this flow', () => {
  expect(isKaleidoPayCode(code)).toBe(true);
  expect(isKaleidoPayCode(offer.toUpperCase())).toBe(true);
  expect(isKaleidoPayCode('lnbc1000')).toBe(false);
});
test('fixed amount wins and missing executor stays unsupported', () => {
  const result = previewPayment(code, 'signet', '12', 'request');
  expect(result.request.amountSat).toBe(50000);
  expect(result.plan.status).toBe('unsupported');
  expect(() => previewPayment(offer, 'signet', '1.2', 'request')).toThrow();
});
test('network isolation, quote totals and unregister', async () => {
  const quote = jest.fn().mockResolvedValue({recipientSat:50000,totalSat:50100,feeSat:100,expiresAt:Math.floor(Date.now()/1000)+60});
  const disconnect = registerKaleidoPayAccount({source:{id:'test',rail:'ln',network:'signet'},swaps:[],quote});
  try {
    const preview = previewPayment(code,'signet','','request');
    expect(preview.plan.status).toBe('ready');
    expect(previewPayment(code,'mutinynet','','request').plan.status).toBe('unsupported');
    expect((await quotePayment(preview)).totalSat).toBe(50100);
    quote.mockResolvedValueOnce({recipientSat:50000,totalSat:50000,feeSat:100,expiresAt:Math.floor(Date.now()/1000)+60});
    await expect(quotePayment(preview)).rejects.toThrow('invalid');
    quote.mockResolvedValueOnce({recipientSat:50000,totalSat:50100,feeSat:100,expiresAt:0});
    await expect(quotePayment(preview)).rejects.toThrow('expired');
    disconnect();
    await expect(quotePayment(preview)).rejects.toThrow('disconnected');
  } finally { disconnect(); }
});

test('normalizes a Lightning URI wrapper for both routing and preview', () => {
  expect(isKaleidoPayCode(`LIGHTNING:${offer}`)).toBe(true);
  expect(isKaleidoPayCode('lightning:lnbc1000')).toBe(false);
  expect(previewPayment(`lightning://${offer}`, 'signet', '1000', 'wrapped').request.amountSat).toBe(1000);
});

test('the offer sets the receiver order; Ark rails without an address are skipped; the address is a fallback', () => {
  const { encodeOffer, withAcceptedRails } = require('@universal-bolt12/universal-code');
  const base = encodeOffer([{ type: 10n, value: new TextEncoder().encode('Shop') }]);
  const arkade = 'arkade:' + 'a'.repeat(64), bark = 'bark:' + 'b'.repeat(64);
  const offer = withAcceptedRails(base, [bark, { rail: arkade, address: 'ark1shop' }, 'ln']);
  const p = previewPayment(`bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.00001&lno=${offer}`, 'mainnet', '', 'order');
  expect(p.request.acceptedRails).toEqual([arkade, 'ln', 'btc:mainnet']);
  expect(p.addresses).toEqual({ [arkade]: 'ark1shop' });
  expect(p.request.acceptedRails.map(railLabel)).toEqual(['Arkade', 'Lightning', 'On-chain']);
  expect(codeNetwork(`lightning:${offer}`)).toBe('mainnet');
  expect(codeNetwork('lno1notanoffer')).toBeUndefined();
});

test('plain mainnet and signet addresses can go to KaleidoPay; regtest and offers cannot', () => {
  expect(isSwappableAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
  expect(isSwappableAddress('bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx?amount=0.001')).toBe(true);
  expect(isSwappableAddress('bcrt1pssfktumhecj6fehwfwsd3vt3w0000000000000000000000000000')).toBe(false);
  expect(isSwappableAddress('lno1qqqq')).toBe(false);
});

test('a bare address is previewed as a bitcoin: URI on its own network', () => {
  const p = previewPayment('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'mainnet', '1500', 'bare');
  expect(p.code.address).toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  expect(p.request).toMatchObject({ amountSat: 1500, acceptedRails: ['btc:mainnet'] });
  expect(codeNetwork('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('mainnet');
});

test('codes with another payment leg, and half-typed addresses, stay on Send', () => {
  expect(isSwappableAddress('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001&lightning=lnbc10u1xyz')).toBe(false);
  expect(isSwappableAddress('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?spark=sp1xyz')).toBe(false);
  expect(isSwappableAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzz')).toBe(false); // bad checksum
  expect(isSwappableAddress('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?label=Shop&message=hi')).toBe(true);
});

test('a fixed-amount offer is paid its own amount, whatever was typed', () => {
  const fixed = encodeOffer([{ type: 8n, value: new Uint8Array([0x02, 0xfa, 0xf0, 0x80]) }, { type: 10n, value: new TextEncoder().encode('Shop') }]); // 50,000,000 msat
  expect(offerAmountSat(fixed)).toBe(50000);
  expect(offerAmountSat(offer)).toBeUndefined();
  expect(previewPayment(fixed, 'signet', '1000', 'fixed').request.amountSat).toBe(50000);
  expect(() => previewPayment(encodePaymentCode({ offer: fixed, amountSat: 1000 }, 'signet'), 'signet', '', 'conflict')).toThrow('two different amounts');
  const usd = encodeOffer([{ type: 6n, value: new TextEncoder().encode('USD') }, { type: 8n, value: new Uint8Array([0x64]) }, { type: 10n, value: new TextEncoder().encode('Shop') }]);
  expect(() => previewPayment(usd, 'signet', '1000', 'usd')).toThrow('another currency');
  const subSat = encodeOffer([{ type: 8n, value: new Uint8Array([0x03, 0xe9]) }, { type: 10n, value: new TextEncoder().encode('Shop') }]); // 1001 msat
  expect(() => offerAmountSat(subSat)).toThrow('whole sats');
});

test('an executor refusing before sending is reported as not sent, never as unknown', async () => {
  const { executePaymentOffer, quotePaymentOffers, PaymentNotSentError } = require('./index');
  const execute = jest.fn().mockRejectedValueOnce(new PaymentNotSentError('Review the payment again to get a fresh quote.'))
    .mockRejectedValueOnce(new Error('socket closed'));
  const quote = jest.fn().mockResolvedValue({ recipientSat: 50000, totalSat: 50100, feeSat: 100, expiresAt: Math.floor(Date.now() / 1000) + 60 });
  const disconnect = registerKaleidoPayAccount({ source: { id: 'notsent', rail: 'ln', network: 'signet' }, swaps: [], quote, execute });
  try {
    const preview = previewPayment(code, 'signet', '', 'request');
    const [offer] = await quotePaymentOffers(preview);
    await expect(executePaymentOffer(preview, offer, 'attempt-1')).rejects.toThrow('fresh quote');
    await expect(executePaymentOffer(preview, (await quotePaymentOffers(preview))[0], 'attempt-1b')).resolves.toEqual({ status: 'unknown' });
    expect(execute).toHaveBeenCalledTimes(2);
  } finally { disconnect(); }
});
