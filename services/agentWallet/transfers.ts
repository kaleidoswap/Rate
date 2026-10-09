// Moving sats between the main wallet and the Agent wallet, and turning the
// Agent wallet off. Both sides are Spark accounts of the same phrase, so these
// are fee-free Spark transfers. Each one is logged before it is sent.

import { withAgentWalletLock } from './lock';
import type { SparkAccountLike } from './account';
import type { AgentWalletStore } from './store';

export interface TransferDeps {
  store: AgentWalletStore;
  main: SparkAccountLike;
  agent: SparkAccountLike;
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'unknown error');

function checkAmount(sats: number) {
  if (!Number.isInteger(sats) || sats <= 0) throw new Error('Enter a whole number of sats above zero.');
}

async function move(
  deps: TransferDeps,
  kind: 'topup' | 'withdraw',
  sats: number,
): Promise<{ status: 'confirmed' | 'pending' }> {
  checkAmount(sats);
  const [from, to] = kind === 'topup' ? [deps.main, deps.agent] : [deps.agent, deps.main];
  if (from.network !== to.network) throw new Error('The two wallets are on different networks.');
  const balance = await from.balanceSats();
  if (!(balance >= sats)) {
    throw new Error(kind === 'topup' ? 'Your main wallet does not have enough on Spark.' : 'The Agent wallet does not have that much.');
  }
  const address = await to.sparkAddress();
  if (address === (await from.sparkAddress())) throw new Error('Both wallets resolved to the same account. Nothing was sent.');
  const entry = await deps.store.add({ kind, amountSats: sats, feeSats: 0, status: 'pending' });
  try {
    const r = await from.sendToSpark(address, sats);
    if (r.status === 'failed') throw new Error('The transfer failed.');
    await deps.store.update(entry.id, { status: r.status === 'confirmed' ? 'paid' : 'pending', paymentHash: r.id || undefined });
    return { status: r.status };
  } catch (e) {
    await deps.store.update(entry.id, { status: 'failed', error: message(e) });
    throw e;
  }
}

export function topUpAgentWallet(deps: TransferDeps, sats: number) {
  return withAgentWalletLock(() => move(deps, 'topup', sats));
}

export function withdrawFromAgentWallet(deps: TransferDeps, sats: number) {
  return withAgentWalletLock(() => move(deps, 'withdraw', sats));
}

/** Send everything back to the main wallet, then turn the Agent wallet off. */
export function disableAgentWallet(deps: TransferDeps): Promise<{ sweptSats: number }> {
  return withAgentWalletLock(async () => {
    const balance = await deps.agent.balanceSats();
    if (!Number.isFinite(balance) || balance < 0) throw new Error('Could not read the Agent wallet balance.');
    if (balance > 0) await move(deps, 'withdraw', balance);
    await deps.store.setEnabled(false);
    return { sweptSats: balance };
  });
}
