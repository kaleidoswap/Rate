// Binds the Agent wallet to the running app: the active wallet, its phrase from
// the secure store, and the connected main Spark account. The agent account is
// opened on first use and kept for the session.

import DatabaseService from '../DatabaseService';
import { protocolManager } from '../protocols';
import { AgentSparkAdapter, agentPayWallet, sparkAccount } from './account';
import { AgentWalletStore } from './store';
import type { AgentPayWallet } from './agentPay';
import type { TransferDeps } from './transfers';

let open: { walletId: number; network: string; adapter: Promise<AgentSparkAdapter> } | null = null;
let generation = 0;

function mainSpark(): any {
  const adapter: any = protocolManager.getAdapterIfAvailable('SPARK');
  if (!adapter?.isConnected?.()) throw new Error('Spark is not connected yet. Try again in a moment.');
  return adapter;
}

export async function activeWalletId(): Promise<number | null> {
  const wallet = await DatabaseService.getInstance().getActiveWallet().catch(() => null);
  return wallet?.id ?? null;
}

export async function agentStore(): Promise<AgentWalletStore | null> {
  const id = await activeWalletId();
  return id ? new AgentWalletStore(id) : null;
}

const changed = () => new Error('The wallet changed. Try again.');

async function teardown(): Promise<void> {
  const current = open;
  open = null;
  const adapter = await current?.adapter.catch(() => null);
  await adapter?.disconnect().catch(() => {});
}

/** The agent's Spark account for the active wallet, connecting it when needed. */
export async function openAgentAccount(): Promise<AgentSparkAdapter> {
  const mine = generation;
  const wallet = await DatabaseService.getInstance().getActiveWallet();
  if (generation !== mine) throw changed();
  if (!wallet?.id || !wallet.encrypted_mnemonic) throw new Error('Unlock your wallet first.');
  const main = mainSpark();
  const network = String(main.network);
  if (open && open.walletId === wallet.id && open.network === network) {
    const adapter = await open.adapter.catch(() => null);
    if (adapter?.isConnected() && generation === mine) return adapter;
  }
  await teardown();
  if (generation !== mine) throw changed();
  const adapter = new AgentSparkAdapter();
  const connecting = adapter.connect({ protocol: 'SPARK', mnemonic: wallet.encrypted_mnemonic, network }).then(async () => {
    // Closed while connecting (wallet switched, removed or locked): never hand it out.
    if (generation !== mine) {
      await adapter.disconnect().catch(() => {});
      throw changed();
    }
    return adapter;
  });
  open = { walletId: wallet.id, network, adapter: connecting };
  try {
    return await connecting;
  } catch (e) {
    if (open?.adapter === connecting) open = null;
    throw e;
  }
}

/** Disconnect the agent account and forget it; any open still in flight is discarded. */
export async function closeAgentAccount(): Promise<void> {
  generation++;
  await teardown();
}

export async function transferDeps(): Promise<TransferDeps> {
  const store = await agentStore();
  if (!store) throw new Error('Unlock your wallet first.');
  const agent = await openAgentAccount();
  return { store, main: sparkAccount(mainSpark()), agent: sparkAccount(agent, () => agent.spendableSats()) };
}

/** The payment gate's view of the Agent wallet, or nulls when it is off or unavailable. */
export async function agentPayDeps(): Promise<{ store: AgentWalletStore | null; wallet: AgentPayWallet | null }> {
  const store = await agentStore().catch(() => null);
  if (!store || !(await store.isEnabled().catch(() => false))) return { store, wallet: null };
  const adapter = await openAgentAccount().catch(() => null);
  return { store, wallet: adapter ? agentPayWallet(adapter) : null };
}
