import { MobileSparkAdapter } from './MobileSparkAdapter';

jest.mock('@kaleidorg/wallet-engine/adapters/wdk', () => ({
  SparkWdkAdapter: class { assertConnected() {} },
}));

function adapterWith(account: any) {
  const adapter = new MobileSparkAdapter();
  (adapter as any).account = account;
  return adapter;
}

describe('Spark payment fee preview', () => {
  it('matches the medium withdrawal speed used at execution', async () => {
    const account = { quoteWithdraw: jest.fn().mockResolvedValue({
      l1BroadcastFeeMedium: { originalValue: 150 }, userFeeMedium: { originalValue: 20 },
      l1BroadcastFeeFast: { originalValue: 500 },
    }) };
    const fee = await adapterWith(account).quotePaymentFee({ method: 'bitcoin_l1', destination: 'bc1-test', amountSats: 1000 });
    expect(fee).toBe(170);
    expect(account.quoteWithdraw).toHaveBeenCalledWith({ amountSats: 1000, withdrawalAddress: 'bc1-test' });
  });
  it('does not silently omit an unknown fee component', async () => {
    const account = { quoteWithdraw: jest.fn().mockResolvedValue({ l1BroadcastFeeMedium: { originalValue: 150 } }) };
    expect(await adapterWith(account).quotePaymentFee({ method: 'bitcoin_l1', destination: 'bc1-test', amountSats: 1000 })).toBeNull();
  });
  it('supplies an amount to Lightning estimation only for amountless invoices', async () => {
    const account = { quotePayLightningInvoice: jest.fn().mockResolvedValue(5n) };
    const adapter = adapterWith(account);
    const request = { method: 'lightning', destination: 'lnbc-invoice', amountSats: 1000 };
    expect(await adapter.quotePaymentFee(request)).toBe(5);
    expect(account.quotePayLightningInvoice).toHaveBeenLastCalledWith({ encodedInvoice: 'lnbc-invoice' });
    await adapter.quotePaymentFee({ ...request, amountless: true });
    expect(account.quotePayLightningInvoice).toHaveBeenLastCalledWith({ encodedInvoice: 'lnbc-invoice', amountSats: 1000 });
  });
});
