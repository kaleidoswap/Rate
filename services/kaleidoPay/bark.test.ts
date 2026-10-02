const mockStatus = jest.fn().mockResolvedValue({ status: 'pending' });
const mockQuoteOptions = jest.fn();
jest.mock('./electrumSwapAccount', () => ({
  createElectrumSwapAccount: ({ source }: any) => ({
    source, swaps: [], providerNames: {}, quoteOptions: mockQuoteOptions,
    execute: jest.fn(), pay: jest.fn(), status: mockStatus,
  }),
}));
jest.mock('./recovery', () => ({ kaleidoPayStores: {} }));
import { createBarkPayAccount } from './bark';

const sender = { sendPayment: jest.fn(), getPaymentStatus: jest.fn() };
test('does not expose an incomplete provider subtotal as the wallet debit', async () => {
  mockQuoteOptions.mockResolvedValue([
    { id: 'live', name: 'Provider', quote: { recipientSat: 500, totalSat: 504, feeSat: 4 } },
    { id: 'offline', name: 'Offline', unavailable: 'Provider did not respond' },
  ]);
  const account = createBarkPayAccount(sender, 'mainnet');
  expect(account.source.network).toBe('mainnet');
  const options = await account.quoteOptions!({} as any, {} as any);
  expect(options[0].quote).toBeUndefined();
  expect(options[0].unavailable).toContain('Bark wallet fees');
  expect(options[1].unavailable).toBe('Provider did not respond');
  await expect(account.quote({} as any, {} as any)).rejects.toThrow('Bark wallet fees');
  expect(account.execute).toBeUndefined();
  expect(account.pay).toBeUndefined();
  expect(sender.sendPayment).not.toHaveBeenCalled();
});
test('keeps status recovery available for previously submitted payments', async () => {
  const account = createBarkPayAccount(sender, 'signet');
  await expect(account.status!('existing-attempt')).resolves.toEqual({ status: 'pending' });
  expect(mockStatus).toHaveBeenCalledWith('existing-attempt');
});
