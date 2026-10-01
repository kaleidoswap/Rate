import { createSparkPayAccount } from './sparkAccount';
import { Preview, Route } from './index';
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map(); return { getItem: jest.fn(async k => values.get(k)), setItem: jest.fn(async (k, v) => { values.set(k, v); }) };
});
const preview = { request: { amountSat: 1000, network: 'mainnet' }, code: { address: 'destination' } } as Preview;
const route = { to: 'btc:mainnet' } as Route;
function setup() {
  const wallet = { getWithdrawalFeeQuote: jest.fn().mockResolvedValue({ id: 'fee-1', expiresAt: new Date(Date.now() + 60000).toISOString(), l1BroadcastFeeMedium: { originalValue: 150 }, userFeeMedium: { originalValue: 20 } }), withdraw: jest.fn().mockResolvedValue({ id: 'request-1', status: 'TX_BROADCASTED' }), getCoopExitRequest: jest.fn().mockResolvedValue({ id: 'request-1', status: 'SUCCEEDED' }) };
  const assertCurrent = jest.fn(); return { wallet, assertCurrent, account: createSparkPayAccount(1, wallet, assertCurrent) };
}
test('quotes without sending and executes accepted fee ID without deducting from recipient', async () => {
  const { wallet, account } = setup(); const quote = await account.quote(preview, route);
  expect(quote.totalSat).toBe(1170); expect(wallet.withdraw).not.toHaveBeenCalled();
  expect((await account.execute!(preview, route, quote, 'a')).status).toBe('pending');
  expect(wallet.withdraw).toHaveBeenCalledWith({ onchainAddress: 'destination', amountSats: 1000, exitSpeed: 'MEDIUM', feeQuoteId: 'fee-1', feeAmountSats: 170, deductFeeFromWithdrawalAmount: false });
  expect((await account.status!('a')).status).toBe('completed');
});
test('rejects unsupported rails, missing fees and switched accounts', async () => {
  const { wallet, account, assertCurrent } = setup();
  await expect(account.quote(preview, { to: 'ln:mainnet' } as Route)).rejects.toThrow('on-chain');
  wallet.getWithdrawalFeeQuote.mockResolvedValueOnce({ id: 'bad', expiresAt: new Date().toISOString() });
  await expect(account.quote(preview, route)).rejects.toThrow('valid fee');
  const quote = await account.quote(preview, route); assertCurrent.mockImplementation(() => { throw new Error('Account changed'); });
  await expect(account.execute!(preview, route, quote, 'b')).rejects.toThrow('Account changed');
  expect(wallet.withdraw).not.toHaveBeenCalled();
});
test('does not claim completion or allow a retry for undocumented or failed statuses', async () => {
  const { account, wallet } = setup(); const quote = await account.quote(preview, route);
  wallet.withdraw.mockResolvedValue({ id: 'request-failed', status: 'FAILED' });
  expect((await account.execute!(preview, route, quote, 'failed')).status).toBe('unknown');
  expect((await account.status!('no-reference')).status).toBe('unknown');
});
