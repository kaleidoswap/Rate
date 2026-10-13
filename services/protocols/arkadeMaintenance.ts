import { assertNoArkadeExit, arkadeRenewalPaused } from './arkadeExit';
import { arkadeBalance, ArkadeBalance } from './arkadeBalance';
import { readDelegateReceipts, saveDelegateReceipts } from './arkadeJournal';
import type { Wallet } from '@arkade-os/sdk';
import { protocolManager } from './index';

export type MaintenanceAction = 'renew' | 'recover' | 'delegate';
export interface ArkadeHealth {
  checkedAt: number; renewalPaused?: boolean; balance: ArkadeBalance; lastDelegatedAt?: number;
  count: number; expiring: number; recoverable: string; subdust: string;
  nextExpiry?: number;
  enabled: boolean; endpoint?: string; delegateFee?: string; delegateError?: string;
  eligible: number; verified: number; persistent: boolean;
  coins: { id: string; sats: number; state: string; expiry?: number }[];
}
// Acknowledgements belong to this live wallet, never another account/network.
const acknowledged = new WeakMap<object, Set<string>>();
const operations = new WeakMap<object, Promise<string>>();
const expiry = (v: any): number | undefined => {
  const value = v.expiresAt ? new Date(v.expiresAt).getTime() : v.virtualStatus?.batchExpiry;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
};
const id = (v: { txid: string; vout: number }) => `${v.txid}:${v.vout}`;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unspent = (v: any) => !v.isUnrolled && !(require('@arkade-os/sdk') as typeof import('@arkade-os/sdk')).hasTerminalSpend(v);
function connected() {
  const adapter: any = protocolManager.getAdapterIfAvailable('ARKADE');
  if (!adapter?.isConnected()) throw new Error('Connect Arkade to check your funds.');
  return { adapter, wallet: adapter.rawWallet as Wallet };
}
async function delegateContext(wallet: Wallet) {
  const manager = await wallet.getDelegateManager();
  if (!manager) throw new Error('Offline renewal is not configured.');
  const info = await manager.getDelegateInfo();
  const sdk = require('@arkade-os/sdk') as typeof import('@arkade-os/sdk');
  const operator = await wallet.arkProvider.getInfo();
  const address = sdk.ArkAddress.decode(info.delegateAddress ?? info.delegatorAddress!);
  const expected = operator.network === 'bitcoin' ? 'ark' : 'tark';
  const signer = sdk.classifyContractSigner(sdk.toXOnlySignerHex(hex(address.serverPubKey)), operator);
  if (address.hrp !== expected || !['CURRENT', 'MIGRATABLE', 'DUE_NOW'].includes(signer.status)) throw new Error('The delegate belongs to a different or expired operator.');
  if (!/^\d+$/.test(info.fee)) throw new Error('The delegate did not provide a supported fee.');
  const key = sdk.toXOnlySignerHex(info.pubkey);
  const cm = await wallet.getContractManager();
  const groups = await cm.getContractsWithVtxos({ type: 'delegate' });
  const coins = groups.filter(({ contract }) => {
    const params = sdk.DelegateContractHandler.deserializeParams(contract.params);
    return sdk.toXOnlySignerHex(hex(params.delegatePubKey)) === key;
  }).flatMap(g => g.vtxos.filter(unspent));
  return { manager, info, coins };
}
async function collectHealth(): Promise<ArkadeHealth> {
  const { adapter, wallet } = connected();
  const manager = await wallet.getVtxoManager();
  const [all, expiring, recovery, rawBalance] = await Promise.all([
    wallet.getVtxos({ withRecoverable: true }), manager.getExpiringVtxos(), manager.getRecoverableBalance(), wallet.getBalance(),
  ]);
  const coins = all.filter(unspent);
  const expiries = coins.map(expiry).filter((n): n is number => typeof n === 'number' && n > 0);
  const health: ArkadeHealth = {
    checkedAt: Date.now(), renewalPaused: arkadeRenewalPaused(wallet), balance: arkadeBalance(rawBalance), count: coins.length, expiring: expiring.length,
    recoverable: String(recovery.recoverable), subdust: String(recovery.subdust),
    nextExpiry: expiries.length ? Math.min(...expiries) : undefined,
    enabled: adapter.delegationEnabled === true, endpoint: adapter.delegatorUrl,
    eligible: 0, verified: 0, persistent: adapter.storagePersistent === true,
    coins: coins.map(v => ({ id: id(v), sats: v.value, state: v.virtualStatus?.state ?? 'unknown', expiry: expiry(v) })),
  };
  if (health.enabled) {
    try {
      const { info, coins: eligible } = await delegateContext(wallet);
      health.delegateFee = info.fee;
      health.eligible = eligible.length;
      const receipts = await readDelegateReceipts(wallet);
      const current = receipts.filter(r => r.delegate === info.pubkey && eligible.some(v => id(v) === r.outpoint));
      health.verified = current.length;
      health.lastDelegatedAt = current.length ? Math.max(...current.map(r => r.acceptedAt)) : undefined;
      // Prune spent/replaced outpoints; historical receipts never imply that renewal succeeded.
      // Do not write during reads: a concurrent registration may have added receipts.
    } catch (error) { health.delegateError = error instanceof Error ? error.message : 'Delegate unavailable'; }
  }
  return health;
}
/** SDK serializes settlement against sends; our lock also prevents duplicate UI submissions. */
export async function maintainArkade(action: MaintenanceAction, onProgress: (stage: string) => void): Promise<string> {
  const { wallet } = connected();
  if (operations.has(wallet)) throw new Error('An Arkade operation is already in progress.');
  const operation = (async () => {
    await assertNoArkadeExit(wallet);
    const manager = await wallet.getVtxoManager();
    if (action === 'delegate') {
      onProgress('Checking delegate…');
      const { manager: delegate, coins, info } = await delegateContext(wallet);
      // Automatic SDK delegation is separate; this explicit check never silently accepts a changed fee.
      if (info.fee !== '0') throw new Error('The delegate now charges a fee. Review the service before continuing.');
      if (!coins.length) throw new Error('No compatible VTXOs yet. Existing funds may need renewal first.');
      onProgress('Registering delegation…');
      const result = await delegate.delegate(coins, await wallet.getAddress());
      const known = acknowledged.get(wallet) ?? new Set<string>();
      for (const v of result.delegated) known.add(id(v));
      acknowledged.set(wallet, known);
      const receipts = await readDelegateReceipts(wallet);
      const current = receipts.filter(r => r.delegate === info.pubkey && coins.some(v => id(v) === r.outpoint) && !result.delegated.some(v => id(v) === r.outpoint));
      await saveDelegateReceipts(wallet, [...current, ...result.delegated.map(v => ({ outpoint: id(v), delegate: info.pubkey, acceptedAt: Date.now() }))]);
      if (result.failed.length) throw new Error('Some VTXOs could not be delegated. Refresh to see verified coverage, then retry.');
      return `${result.delegated.length}`;
    }
    onProgress(action === 'renew' ? 'Renewing VTXOs…' : 'Recovering funds…');
    const progress = () => onProgress('Waiting for Arkade settlement…');
    return action === 'renew' ? manager.renewVtxos(progress) : manager.recoverVtxos(progress);
  })();
  operations.set(wallet, operation);
  try { return await operation; } finally { operations.delete(wallet); }
}

/** Bound read-only UI waits. A timed-out mutation must never be retried automatically. */
export async function readArkadeHealth(): Promise<ArkadeHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([collectHealth(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Arkade did not respond. Refresh to try again.')), 20000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
