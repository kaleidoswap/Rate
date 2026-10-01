import { encodeOffer, encodePaymentCode } from './universalCode';
import { previewPayment, quotePayment, registerKaleidoPayAccount, isKaleidoPayCode } from './index';
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
