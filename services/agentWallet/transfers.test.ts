jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
import { disableAgentWallet, topUpAgentWallet, withdrawFromAgentWallet } from './transfers';
import { AgentWalletStore } from './store';
import type { SparkAccountLike } from './account';
import { memoryStorage } from './__fixtures__/memoryStorage';

function fakeAccounts(mainSats: number, agentSats: number) {
  const balances: Record<string, number> = { main: mainSats, agent: agentSats };
  const account = (name: 'main' | 'agent'): SparkAccountLike & { sendToSpark: jest.Mock } => ({
    network: 'mainnet',
    sparkAddress: async () => `spark1${name}`,
    balanceSats: async () => balances[name],
    sendToSpark: jest.fn(async (address: string, sats: number) => {
      balances[name] -= sats;
      balances[address.replace('spark1', '')] += sats;
      return { id: `tx-${name}-${sats}`, status: 'confirmed' as const };
    }),
  });
  return { balances, main: account('main'), agent: account('agent') };
}

async function setup(mainSats = 10_000, agentSats = 0) {
  const store = new AgentWalletStore(3, memoryStorage());
  await store.setEnabled(true);
  const accounts = fakeAccounts(mainSats, agentSats);
  return { store, ...accounts, deps: { store, main: accounts.main, agent: accounts.agent } };
}

describe('agent wallet transfers', () => {
  it('tops up from the main wallet and withdraws back, logging both', async () => {
    const { deps, balances, store } = await setup();
    await topUpAgentWallet(deps, 4000);
    await withdrawFromAgentWallet(deps, 1500);
    expect(balances).toEqual({ main: 7500, agent: 2500 });
    const log = await store.entries();
    expect(log.map((e) => [e.kind, e.amountSats, e.status, e.paymentHash])).toEqual([
      ['withdraw', 1500, 'paid', 'tx-agent-1500'],
      ['topup', 4000, 'paid', 'tx-main-4000'],
    ]);
    expect(await store.totals()).toEqual({ todaySats: 0, monthSats: 0 });
  });

  it('refuses bad amounts and more than the balance, sending nothing', async () => {
    const { deps, main, agent, store } = await setup(1000, 100);
    await expect(topUpAgentWallet(deps, 0)).rejects.toThrow();
    await expect(topUpAgentWallet(deps, 1.5)).rejects.toThrow();
    await expect(topUpAgentWallet(deps, 1001)).rejects.toThrow(/main wallet/);
    await expect(withdrawFromAgentWallet(deps, 101)).rejects.toThrow(/Agent wallet/);
    expect(main.sendToSpark).not.toHaveBeenCalled();
    expect(agent.sendToSpark).not.toHaveBeenCalled();
    expect(await store.entries()).toEqual([]);
  });

  it('never sends when both sides are the same account or on different networks', async () => {
    const { deps } = await setup();
    const same = { ...deps, agent: { ...deps.agent, sparkAddress: deps.main.sparkAddress } };
    await expect(topUpAgentWallet(same, 10)).rejects.toThrow(/same account/);
    const other = { ...deps, agent: { ...deps.agent, network: 'regtest' } };
    await expect(topUpAgentWallet(other, 10)).rejects.toThrow(/networks/);
    expect(deps.main.sendToSpark).not.toHaveBeenCalled();
  });

  it('marks a failed transfer as failed', async () => {
    const { deps, store, main } = await setup();
    main.sendToSpark.mockRejectedValueOnce(new Error('offline'));
    await expect(topUpAgentWallet(deps, 10)).rejects.toThrow('offline');
    expect((await store.entries())[0]).toMatchObject({ kind: 'topup', status: 'failed', error: 'offline' });
  });

  it('disabling sweeps everything back and turns it off', async () => {
    const { deps, balances, store } = await setup(0, 2222);
    expect(await disableAgentWallet(deps)).toEqual({ sweptSats: 2222 });
    expect(balances).toEqual({ main: 2222, agent: 0 });
    expect(await store.isEnabled()).toBe(false);
  });

  it('stays on when the sweep fails', async () => {
    const { deps, store, agent } = await setup(0, 500);
    agent.sendToSpark.mockRejectedValueOnce(new Error('offline'));
    await expect(disableAgentWallet(deps)).rejects.toThrow('offline');
    expect(await store.isEnabled()).toBe(true);
  });

  it('turns off an empty wallet without sending', async () => {
    const { deps, store, agent } = await setup(0, 0);
    expect(await disableAgentWallet(deps)).toEqual({ sweptSats: 0 });
    expect(agent.sendToSpark).not.toHaveBeenCalled();
    expect(await store.isEnabled()).toBe(false);
  });
});
