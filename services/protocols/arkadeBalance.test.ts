import { arkadeBalance, withArkadeBalance } from './arkadeBalance';
const raw = { total: 10000, available: 2500, settled: 5000, preconfirmed: 1000, intentLocked: 2000, gated: 1500, unrolled: 1000, boarding: { confirmed: 1000, unconfirmed: 500 }, recoverable: 500, pendingRecovery: 1000 };
test('uses SDK selection and subtracts exited funds only from Arkade total', () => {
  expect(arkadeBalance(raw)).toMatchObject({ total: 9000, available: 2500, exited: 1000, locked: 3500 });
});
test('missing or inconsistent balances cannot become spendable zero', () => {
  expect(() => arkadeBalance({ total: 1 })).toThrow('incomplete');
  expect(() => arkadeBalance({ total: 1, available: 2 })).toThrow('inconsistent');
});
test('public adapter balance and asset agree on spendable funds', async () => {
  const adapter = withArkadeBalance({ rawWallet: { getBalance: async () => raw }, getBtcBalance: async () => ({}), listAssets: async () => [{ id: 'BTC', balance: {} }] });
  expect(await adapter.getBtcBalance()).toEqual({ confirmed: 2500, unconfirmed: 6500, total: 9000 });
  expect((await adapter.listAssets())[0].balance).toMatchObject({ available: 2500, total: 9000 });
});
