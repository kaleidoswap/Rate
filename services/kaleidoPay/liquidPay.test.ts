jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { connectLiquidPayAccounts, createLiquidPayAccount, LIQUID_FEE_ESTIMATE_SAT, LIQUID_LIGHTNING_UNAVAILABLE, liquidLightningOption } from './liquidPay';
import { executePaymentOffer, PaymentNotSentError, previewTarget, quotePaymentOffers } from './index';
import type { Preview, Route } from './index';

const route = { kind: 'direct', sourceId: 'liquid', from: 'liquid:mainnet', to: 'liquid:mainnet' } as Route;
const preview = (liquidAddress = 'lq1dest', amountSat = 20000) => ({ code: { kind: 'liquid', raw: liquidAddress, liquidAddress }, request: { id: 'r', network: 'mainnet', networks: ['mainnet'], amountSat, acceptedRails: ['liquid'] }, plan: {}, addresses: {} }) as unknown as Preview;

function liquid(balance = 100000) {
  return {
    connected: true,
    isConnected: jest.fn(function (this: any) { return this.connected; }),
    getBtcBalance: jest.fn().mockResolvedValue({ confirmed: balance }),
    sendPayment: jest.fn().mockResolvedValue({ paymentHash: 'liquid-tx', status: 'pending' }),
    getPaymentStatus: jest.fn().mockResolvedValue({ status: 'pending' }),
  };
}

test('quotes a conservative, marked fee and refuses a balance shortfall', async () => {
  const l = liquid(20000 + LIQUID_FEE_ESTIMATE_SAT);
  const account = createLiquidPayAccount(l, 'mainnet');
  const [option] = await account.quoteOptions!(preview(), route);
  expect(option.quote).toMatchObject({ recipientSat: 20000, feeSat: LIQUID_FEE_ESTIMATE_SAT, totalSat: 20000 + LIQUID_FEE_ESTIMATE_SAT });
  expect(option.detail).toContain('Estimated');
  l.getBtcBalance.mockResolvedValue({ confirmed: 20000 });
  const [short] = await account.quoteOptions!(preview(), route);
  expect(short.unavailable).toBe('Not enough balance in Liquid');
  expect(l.sendPayment).not.toHaveBeenCalled();
});

test('sends L-BTC sats to the address; the txid stays pending until confirmed', async () => {
  const l = liquid();
  const account = createLiquidPayAccount(l, 'mainnet');
  const quote = await account.quote(preview(), route);
  await expect(account.execute!(preview(), route, quote, 'a1')).resolves.toEqual({ status: 'pending', reference: 'liquid-tx' });
  expect(l.sendPayment).toHaveBeenCalledWith({ invoice: 'lq1dest', amount: 20000 });
  await expect(account.status!('a1')).resolves.toEqual({ status: 'pending', reference: 'liquid-tx' });
  l.getPaymentStatus.mockResolvedValueOnce({ status: 'confirmed' });
  await expect(account.status!('a1')).resolves.toEqual({ status: 'completed', reference: 'liquid-tx' });
  expect(l.getPaymentStatus).toHaveBeenCalledWith('liquid-tx');
  // Stored once final: no further lookups.
  await expect(account.status!('a1')).resolves.toEqual({ status: 'completed', reference: 'liquid-tx' });
  expect(l.getPaymentStatus).toHaveBeenCalledTimes(2);
});

test('stale quotes, changed addresses and disconnects are refused before sending', async () => {
  const l = liquid();
  const account = createLiquidPayAccount(l, 'mainnet');
  const quote = await account.quote(preview(), route);
  await expect(account.execute!(preview(), route, { ...quote, expiresAt: 1 }, 'b1')).rejects.toBeInstanceOf(PaymentNotSentError);
  await expect(account.execute!(preview('lq1other'), route, quote, 'b2')).rejects.toBeInstanceOf(PaymentNotSentError);
  l.connected = false;
  await expect(account.execute!(preview(), route, quote, 'b3')).rejects.toBeInstanceOf(PaymentNotSentError);
  expect(l.sendPayment).not.toHaveBeenCalled();
});

test('through the engine, and Lightning shows only as unavailable', async () => {
  const l = liquid();
  const disconnect = connectLiquidPayAccounts(l, 'mainnet');
  try {
    const p = previewTarget({ kind: 'liquid', raw: 'lq1dest', liquidAddress: 'lq1dest', networks: ['mainnet'] }, 20000, 'req-l');
    const [offer] = await quotePaymentOffers(p);
    expect(offer.route.sourceId).toBe('liquid');
    await expect(executePaymentOffer(p, offer, 'engine-l')).resolves.toEqual({ status: 'pending', reference: 'liquid-tx' });
    const ln = { ...p, request: { ...p.request, acceptedRails: ['ln'] } };
    expect(liquidLightningOption(ln)).toEqual({ id: 'liquid-ln', name: 'Liquid → Lightning', unavailable: LIQUID_LIGHTNING_UNAVAILABLE });
    expect(liquidLightningOption(p)).toBeUndefined();
  } finally { disconnect(); }
  expect(liquidLightningOption({ ...preview(), request: { ...preview().request, acceptedRails: ['ln'] } })).toBeUndefined();
});
