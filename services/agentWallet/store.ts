// Per-wallet records for the Agent wallet: whether it is on, its spending
// rules and the log of everything it paid, received from the main wallet or
// sent back. Nothing here is secret; keys stay with the recovery phrase.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_POLICY, normalizePolicy, policyProblem, type SpendTotals, type SpendingPolicy } from './policy';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type AgentEntryKind = 'spend' | 'topup' | 'withdraw';
export type AgentEntryStatus = 'pending' | 'paid' | 'failed' | 'refused' | 'cancelled';

export interface AgentLedgerEntry {
  id: string;
  kind: AgentEntryKind;
  at: number;
  amountSats: number;
  feeSats: number;
  status: AgentEntryStatus;
  /** Host that was paid (spends). */
  service?: string;
  /** The tool or request behind the payment. */
  reason?: string;
  paymentHash?: string;
  error?: string;
}

const MAX_ENTRIES = 500;
const key = (walletId: number, what: string) => `agentWallet:${what}:${walletId}`;

/** Spends that count toward the limits: paid, and sent but not yet settled. */
export const countsTowardLimits = (e: AgentLedgerEntry) => e.kind === 'spend' && (e.status === 'paid' || e.status === 'pending');

export function windowTotals(entries: AgentLedgerEntry[], now = Date.now()): SpendTotals {
  const d = new Date(now);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  let todaySats = 0;
  let monthSats = 0;
  for (const e of entries) {
    if (!countsTowardLimits(e)) continue;
    const cost = e.amountSats + e.feeSats;
    if (e.at >= monthStart) monthSats += cost;
    if (e.at >= dayStart) todaySats += cost;
  }
  return { todaySats, monthSats };
}

function validEntry(e: any): e is AgentLedgerEntry {
  return !!e && typeof e.id === 'string' && ['spend', 'topup', 'withdraw'].includes(e.kind)
    && Number.isFinite(e.at) && Number.isFinite(e.amountSats) && Number.isFinite(e.feeSats)
    && ['pending', 'paid', 'failed', 'refused', 'cancelled'].includes(e.status);
}

let idCounter = 0;
const newId = (now: number) => `ag-${now.toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class AgentWalletStore {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(readonly walletId: number, private storage: KeyValueStorage = AsyncStorage) {
    if (!Number.isInteger(walletId) || walletId <= 0) throw new Error('No active wallet');
  }

  async isEnabled(): Promise<boolean> {
    return (await this.storage.getItem(key(this.walletId, 'enabled'))) === '1';
  }

  async setEnabled(on: boolean): Promise<void> {
    if (on) await this.storage.setItem(key(this.walletId, 'enabled'), '1');
    else await this.storage.removeItem(key(this.walletId, 'enabled'));
  }

  /** The saved rules, the defaults when none were saved, or null when the saved copy is damaged. */
  async loadPolicy(): Promise<SpendingPolicy | null> {
    const raw = await this.storage.getItem(key(this.walletId, 'policy'));
    if (raw == null) return { ...DEFAULT_POLICY, allowedServices: [] };
    try {
      return normalizePolicy(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Only the Agent wallet settings screen calls this. */
  async savePolicy(policy: SpendingPolicy): Promise<SpendingPolicy> {
    const clean = normalizePolicy(policy);
    if (!clean) throw new Error('These limits are not valid.');
    const problem = policyProblem(clean);
    if (problem) throw new Error(problem);
    await this.storage.setItem(key(this.walletId, 'policy'), JSON.stringify(clean));
    return clean;
  }

  async entries(): Promise<AgentLedgerEntry[]> {
    const raw = await this.storage.getItem(key(this.walletId, 'log'));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('The Agent wallet log is damaged.');
    return parsed.filter(validEntry);
  }

  async totals(now = Date.now()): Promise<SpendTotals> {
    return windowTotals(await this.entries(), now);
  }

  async add(entry: Omit<AgentLedgerEntry, 'id' | 'at'> & { at?: number }): Promise<AgentLedgerEntry> {
    const at = entry.at ?? Date.now();
    const full: AgentLedgerEntry = { ...entry, at, id: newId(at) };
    await this.mutate((list) => [full, ...list]);
    return full;
  }

  async update(id: string, patch: Partial<Omit<AgentLedgerEntry, 'id' | 'kind' | 'at'>>): Promise<void> {
    await this.mutate((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  private mutate(fn: (list: AgentLedgerEntry[]) => AgentLedgerEntry[]): Promise<void> {
    const run = this.writes.then(async () => {
      const next = fn(await this.entries());
      // Keep the newest entries, and every spend that can still count toward a limit.
      const cutoff = Date.now() - 32 * 86_400_000;
      const kept = next.filter((e, i) => i < MAX_ENTRIES || e.status === 'pending' || (countsTowardLimits(e) && e.at >= cutoff));
      await this.storage.setItem(key(this.walletId, 'log'), JSON.stringify(kept));
    });
    this.writes = run.catch(() => {});
    return run;
  }
}
