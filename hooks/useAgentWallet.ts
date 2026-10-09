import { useCallback, useEffect, useRef, useState } from 'react';
import { agentStore, closeAgentAccount, openAgentAccount, transferDeps } from '../services/agentWallet/live';
import { disableAgentWallet, topUpAgentWallet, withdrawFromAgentWallet } from '../services/agentWallet/transfers';
import type { SpendingPolicy, SpendTotals } from '../services/agentWallet/policy';
import type { AgentLedgerEntry } from '../services/agentWallet/store';

export interface AgentWalletState {
  loading: boolean;
  enabled: boolean;
  balanceSats: number | null;
  policy: SpendingPolicy | null;
  totals: SpendTotals | null;
  entries: AgentLedgerEntry[];
  error: string | null;
}

const EMPTY: AgentWalletState = { loading: true, enabled: false, balanceSats: null, policy: null, totals: null, entries: [], error: null };
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong.');

export function useAgentWallet() {
  const [state, setState] = useState<AgentWalletState>(EMPTY);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const store = await agentStore();
      if (!store) throw new Error('Unlock your wallet first.');
      const [enabled, policy, entries] = await Promise.all([store.isEnabled(), store.loadPolicy(), store.entries().catch(() => [])]);
      const totals = await store.totals().catch(() => null);
      let balanceSats: number | null = null;
      let error: string | null = null;
      if (enabled) {
        try { balanceSats = await (await openAgentAccount()).spendableSats(); }
        catch (e) { error = message(e); }
      }
      if (alive.current) setState({ loading: false, enabled, balanceSats, policy, totals, entries, error });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error: message(e) }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    await openAgentAccount();
    const store = await agentStore();
    if (!store) throw new Error('Unlock your wallet first.');
    await store.setEnabled(true);
    await refresh();
  }, [refresh]);

  const topUp = useCallback(async (sats: number) => {
    try { return await topUpAgentWallet(await transferDeps(), sats); } finally { await refresh(); }
  }, [refresh]);

  const withdraw = useCallback(async (sats: number) => {
    try { return await withdrawFromAgentWallet(await transferDeps(), sats); } finally { await refresh(); }
  }, [refresh]);

  const disable = useCallback(async () => {
    try {
      const result = await disableAgentWallet(await transferDeps());
      await closeAgentAccount();
      return result;
    } finally {
      await refresh();
    }
  }, [refresh]);

  const savePolicy = useCallback(async (policy: SpendingPolicy) => {
    const store = await agentStore();
    if (!store) throw new Error('Unlock your wallet first.');
    const saved = await store.savePolicy(policy);
    await refresh();
    return saved;
  }, [refresh]);

  return { state, refresh, enable, topUp, withdraw, disable, savePolicy };
}
