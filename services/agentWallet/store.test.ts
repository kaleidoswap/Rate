jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
import { AgentWalletStore, windowTotals, type AgentLedgerEntry } from './store';
import { DEFAULT_POLICY } from './policy';
import { memoryStorage } from './__fixtures__/memoryStorage';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const entry = (patch: Partial<AgentLedgerEntry>): AgentLedgerEntry => ({
  id: Math.random().toString(36), kind: 'spend', at: at(2026, 9, 9), amountSats: 100, feeSats: 1, status: 'paid', ...patch,
});

describe('windowTotals', () => {
  const now = at(2026, 9, 9, 15);
  it('adds paid and pending spends, fees included, per calendar day and month', () => {
    const list = [
      entry({}),
      entry({ status: 'pending', amountSats: 50, feeSats: 0 }),
      entry({ at: at(2026, 9, 8), amountSats: 200, feeSats: 0 }),
      entry({ at: at(2026, 8, 30), amountSats: 999 }),
      entry({ status: 'failed', amountSats: 5000 }),
      entry({ status: 'refused', amountSats: 5000 }),
      entry({ status: 'cancelled', amountSats: 5000 }),
      entry({ kind: 'topup', amountSats: 5000 }),
      entry({ kind: 'withdraw', amountSats: 5000 }),
    ];
    expect(windowTotals(list, now)).toEqual({ todaySats: 151, monthSats: 351 });
  });
  it('starts over at midnight and on the first of the month', () => {
    const list = [entry({ at: at(2026, 9, 31, 23) })];
    expect(windowTotals(list, at(2026, 10, 1, 0))).toEqual({ todaySats: 0, monthSats: 0 });
    expect(windowTotals(list, at(2026, 9, 31, 23) + 1000)).toEqual({ todaySats: 101, monthSats: 101 });
  });
});

describe('AgentWalletStore', () => {
  it('needs a wallet', () => {
    expect(() => new AgentWalletStore(0, memoryStorage())).toThrow();
  });

  it('keeps state per wallet', async () => {
    const storage = memoryStorage();
    const a = new AgentWalletStore(1, storage);
    const b = new AgentWalletStore(2, storage);
    await a.setEnabled(true);
    await a.add({ kind: 'topup', amountSats: 1000, feeSats: 0, status: 'paid' });
    expect(await a.isEnabled()).toBe(true);
    expect(await b.isEnabled()).toBe(false);
    expect(await b.entries()).toEqual([]);
    await a.setEnabled(false);
    expect(await a.isEnabled()).toBe(false);
  });

  it('uses the defaults until the user saves rules, and refuses bad rules', async () => {
    const store = new AgentWalletStore(1, memoryStorage());
    expect(await store.loadPolicy()).toEqual(DEFAULT_POLICY);
    const saved = await store.savePolicy({ ...DEFAULT_POLICY, allowedServices: ['API.example.com'] });
    expect(saved.allowedServices).toEqual(['api.example.com']);
    expect(await store.loadPolicy()).toEqual(saved);
    await expect(store.savePolicy({ ...DEFAULT_POLICY, perPaymentSats: -5 })).rejects.toThrow();
    await expect(store.savePolicy({ ...DEFAULT_POLICY, perPaymentSats: 9000 })).rejects.toThrow(/daily/);
  });

  it('reads a damaged policy or log as unusable', async () => {
    const storage = memoryStorage({ 'agentWallet:policy:1': '{nope', 'agentWallet:log:1': '{"a":1}' });
    const store = new AgentWalletStore(1, storage);
    expect(await store.loadPolicy()).toBeNull();
    await expect(store.totals()).rejects.toThrow();
    storage.data['agentWallet:policy:1'] = JSON.stringify({ ...DEFAULT_POLICY, dailySats: 'lots' });
    expect(await store.loadPolicy()).toBeNull();
  });

  it('logs and updates entries without losing concurrent writes', async () => {
    const store = new AgentWalletStore(1, memoryStorage());
    const added = await Promise.all([1, 2, 3, 4, 5].map((n) => store.add({ kind: 'spend', amountSats: n, feeSats: 0, status: 'pending', service: 'a.com' })));
    await store.update(added[2].id, { status: 'paid', feeSats: 2 });
    const list = await store.entries();
    expect(list).toHaveLength(5);
    expect(list.find((e) => e.id === added[2].id)).toMatchObject({ status: 'paid', feeSats: 2, amountSats: 3 });
  });
});
