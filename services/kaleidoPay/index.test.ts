import { encodeOffer, encodePaymentCode } from '@universal-bolt12/universal-code';
import { isSwappableAddress, codeNetwork, previewPayment, quotePayment, railLabel, registerKaleidoPayAccount, isKaleidoPayCode } from './index';
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
