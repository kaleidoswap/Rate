// Settles agent payments left pending (an unanswered send, an app closed
// mid-payment) so they stop counting against the limits once they are known
// to have failed. A lookup that errors leaves the entry pending, and counted.

import type { AgentPayWallet } from './agentPay';
import type { AgentWalletStore } from './store';
import { withAgentWalletLock } from './lock';

/** Returns how many entries changed. Throws only when the log can't be read. */
export async function reconcilePending(store: AgentWalletStore, wallet: Pick<AgentPayWallet, 'paymentStatus'>, now = Date.now()): Promise<number> {
  const pending = (await store.entries()).filter((e) => e.kind === 'spend' && e.status === 'pending');
  let changed = 0;
  for (const e of pending) {
    if (!e.paymentId && !e.invoice) continue;
    let s;
    try {
      s = await wallet.paymentStatus({ id: e.paymentId, invoice: e.invoice });
    } catch {
      continue;
    }
    if (s.status === 'confirmed') {
      await store.update(e.id, { status: 'paid', feeSats: Number.isInteger(s.feeSats) && (s.feeSats as number) >= 0 ? (s.feeSats as number) : e.feeSats, ...(s.id ? { paymentId: s.id } : {}) });
    } else if (s.status === 'failed') {
      await store.update(e.id, { status: 'failed', feeSats: 0, error: 'The payment failed.' });
    } else if (e.expiresAt != null && now >= e.expiresAt) {
      await store.update(e.id, { status: 'failed', feeSats: 0, error: 'The invoice expired before the payment settled.' });
    } else {
      if (s.id && !e.paymentId) await store.update(e.id, { paymentId: s.id });
      continue;
    }
    changed++;
  }
  return changed;
}

/** Reconcile outside a payment (opening the wallet, budget questions). */
export function reconcileAgentWallet(store: AgentWalletStore, wallet: Pick<AgentPayWallet, 'paymentStatus'>, now = Date.now()): Promise<number> {
  return withAgentWalletLock(() => reconcilePending(store, wallet, now)).catch(() => 0);
}
