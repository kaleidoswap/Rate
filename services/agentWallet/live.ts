// Binds the Agent wallet to the running app: the active wallet, its phrase from
// the secure store, and the connected main Spark account. The agent account is
// opened on first use and kept for the session.

import DatabaseService from '../DatabaseService';
import { protocolManager, sparkClientManager } from '../protocols';
import { AgentSparkAdapter, agentPayWallet, sparkAccount } from './account';
import { AgentWalletStore } from './store';
import type { AgentPayWallet } from './agentPay';
import type { TransferDeps } from './transfers';

let open: { walletId: number; network: string; adapter: Promise<AgentSparkAdapter> } | null = null;

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

/** The agent's Spark account for the active wallet, connecting it when needed. */
export async function openAgentAccount(): Promise<AgentSparkAdapter> {
  const wallet = await DatabaseService.getInstance().getActiveWallet();
  if (!wallet?.id || !wallet.encrypted_mnemonic) throw new Error('Unlock your wallet first.');
  const main = mainSpark();
  const network = String(main.network);
  if (open && open.walletId === wallet.id && open.network === network) {
    const adapter = await open.adapter.catch(() => null);
    if (adapter?.isConnected()) return adapter;
  }
  await closeAgentAccount();
  const adapter = new AgentSparkAdapter(sparkClientManager as any, () => mainSpark().account?._wallet);
  const connecting = adapter.connect({ protocol: 'SPARK', mnemonic: wallet.encrypted_mnemonic, network }).then(() => adapter);
  open = { walletId: wallet.id, network, adapter: connecting };
  try {
    return await connecting;
  } catch (e) {
    if (open?.adapter === connecting) open = null;
    throw e;
  }
}

export async function closeAgentAccount(): Promise<void> {
  const current = open;
  open = null;
  const adapter = await current?.adapter.catch(() => null);
  await adapter?.disconnect().catch(() => {});
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
