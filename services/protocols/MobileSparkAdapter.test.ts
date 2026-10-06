import { MobileSparkAdapter, sparkTransferStatus } from './MobileSparkAdapter';

let mockSuperStatus: any = { status: 'pending' };
jest.mock('@kaleidorg/wallet-engine/adapters/wdk', () => ({
  SparkWdkAdapter: class { assertConnected() {} async getBtcBalance() { return { confirmed: 5000, unconfirmed: 0, total: 5000 }; } async getPaymentStatus(id: string) { return { paymentHash: id, ...mockSuperStatus }; } },
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

describe('Spark payment status', () => {
  it('reads the numeric transfer status the SDK returns', () => {
    expect(sparkTransferStatus(5)).toBe('confirmed');                       // COMPLETED
    expect(sparkTransferStatus(2)).toBe('confirmed');                       // sender key tweaked: receiver can claim
    expect(sparkTransferStatus('TRANSFER_STATUS_COMPLETED')).toBe('confirmed');
    expect(sparkTransferStatus(6)).toBe('failed');                          // EXPIRED
    expect(sparkTransferStatus(7)).toBe('failed');                          // RETURNED
    expect(sparkTransferStatus(0)).toBe('pending');
    expect(sparkTransferStatus(undefined)).toBe('pending');
  });

  it('a sent transfer resolves instead of staying pending forever', async () => {
    mockSuperStatus = { status: 'pending', amount: 1000 };
    const account = { getTransactionReceipt: jest.fn().mockResolvedValue({ status: 5 }) };
    expect((await adapterWith(account).getPaymentStatus('Transfer:abc')).status).toBe('confirmed');
    expect(account.getTransactionReceipt).toHaveBeenCalledWith('abc');
  });

  it('leaves Lightning sends and missing receipts to the engine', async () => {
    mockSuperStatus = { status: 'pending' }; // no amount: not a transfer receipt
    const account = { getTransactionReceipt: jest.fn() };
    expect((await adapterWith(account).getPaymentStatus('ln-1')).status).toBe('pending');
    expect(account.getTransactionReceipt).not.toHaveBeenCalled();
    mockSuperStatus = { status: 'confirmed', amount: 5 };
    expect((await adapterWith(account).getPaymentStatus('t')).status).toBe('confirmed');
  });
});

describe('Spark balance', () => {
  it('shows received-but-unclaimed transfers as incoming, not spendable', async () => {
    const adapter = new MobileSparkAdapter();
    Object.defineProperty(adapter, 'rawWallet', { get: () => ({ getCachedBalance: async () => ({ satsBalance: { incoming: 1200n } }) }) });
    expect(await adapter.getBtcBalance()).toEqual({ confirmed: 5000, unconfirmed: 1200, total: 6200 });
  });
  it('keeps the spendable balance when nothing is incoming or the read fails', async () => {
    const adapter = new MobileSparkAdapter();
    Object.defineProperty(adapter, 'rawWallet', { get: () => ({ getCachedBalance: async () => { throw new Error('x'); } }) });
    expect(await adapter.getBtcBalance()).toEqual({ confirmed: 5000, unconfirmed: 0, total: 5000 });
  });
});
