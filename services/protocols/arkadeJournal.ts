import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Wallet } from '@arkade-os/sdk';
const hex = (value: Uint8Array) => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
/** Public identity + operator, never a mnemonic or rotating receive address. */
export async function arkadeScope(wallet: Wallet): Promise<string> {
  const url = (wallet.arkProvider as unknown as { serverUrl?: string }).serverUrl;
  if (!url) throw new Error('Cannot identify the Arkade operator for local recovery.');
  return `arkade-v1:${hex(await wallet.identity.xOnlyPublicKey())}:${encodeURIComponent(url)}`;
}
export type DelegateReceipt = { outpoint: string; delegate: string; acceptedAt: number };
export async function readDelegateReceipts(wallet: Wallet): Promise<DelegateReceipt[]> {
  const raw = await AsyncStorage.getItem(`${await arkadeScope(wallet)}:delegations`);
  if (!raw) return [];
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('Could not read delegation receipts.');
  return rows.filter(r => typeof r.outpoint === 'string' && typeof r.delegate === 'string' && Number.isSafeInteger(r.acceptedAt));
}
export async function saveDelegateReceipts(wallet: Wallet, rows: DelegateReceipt[]): Promise<void> {
  await AsyncStorage.setItem(`${await arkadeScope(wallet)}:delegations`, JSON.stringify(rows));
}
