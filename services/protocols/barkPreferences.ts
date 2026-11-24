import DatabaseService from '../DatabaseService';
import { barkWalletKey, BARK_DEFAULT_ENDPOINTS, resolveBarkHostConfig, type BarkHostConfig, type BarkNetwork } from './bark';

const key = (mnemonic: string) => `bark-network-v1-${barkWalletKey(mnemonic)}`;
const lastNetworkKey = (mnemonic: string) => `bark-last-network-v1-${barkWalletKey(mnemonic)}`;
let connected: { walletKey: string; host: BarkHostConfig } | null = null;

export const currentBarkHost = () => connected?.host ?? resolveBarkHostConfig();
export const barkConnectionMatches = (mnemonic: string, host: BarkHostConfig) => connected?.walletKey === barkWalletKey(mnemonic)
  && connected.host.network === host.network && connected.host.arkServerUrl === host.arkServerUrl && connected.host.esploraUrl === host.esploraUrl;
export const recordBarkConnection = (mnemonic: string, host: BarkHostConfig) => { connected = { walletKey: barkWalletKey(mnemonic), host }; };
export const clearBarkConnection = () => { connected = null; };

/** Non-secret preference scoped to the same wallet identity as Bark's data directory. */
/** 'off' turns Bark off for this wallet (chosen at setup or in Settings). */
const OFF = 'off';

/** True when this wallet turned Bark off. Wallets with no choice keep the default (on). */
export async function isBarkOff(mnemonic: string): Promise<boolean> {
  return (await DatabaseService.getInstance().getSetting(key(mnemonic))) === OFF;
}

export async function hasBarkPreference(mnemonic: string): Promise<boolean> {
  const saved = await DatabaseService.getInstance().getSetting(key(mnemonic));
  return saved === OFF || saved === 'mainnet' || saved === 'signet';
}

/** The selected network, including while an account is turned off. */
export async function preferredBarkNetwork(mnemonic: string): Promise<BarkNetwork> {
  const db = DatabaseService.getInstance();
  const saved = await db.getSetting(key(mnemonic));
  if (saved === 'mainnet' || saved === 'signet') return saved;
  if (saved === OFF) {
    const previous = await db.getSetting(lastNetworkKey(mnemonic));
    if (previous === 'mainnet' || previous === 'signet') return previous;
  }
  return resolveBarkHostConfig()?.network ?? 'mainnet';
}

export async function setBarkOff(mnemonic: string): Promise<void> {
  const db = DatabaseService.getInstance();
  await db.setSetting(lastNetworkKey(mnemonic), await preferredBarkNetwork(mnemonic));
  await db.setSetting(key(mnemonic), OFF);
}

export async function loadBarkHost(mnemonic: string): Promise<BarkHostConfig | null> {
  const saved = await DatabaseService.getInstance().getSetting(key(mnemonic));
  if (!saved) return resolveBarkHostConfig();
  if (saved === OFF) return null;
  if (saved !== 'mainnet' && saved !== 'signet') throw new Error('Bark network setting is invalid. Choose a network in Settings.');
  // Explicit user choices use the public server for that network, never an env
  // endpoint belonging to a different chain.
  return { network: saved, ...BARK_DEFAULT_ENDPOINTS[saved]! };
}

export async function saveBarkNetwork(mnemonic: string, network: BarkNetwork): Promise<void> {
  if (network !== 'mainnet' && network !== 'signet') throw new Error('Unsupported Bark network.');
  await DatabaseService.getInstance().setSetting(key(mnemonic), network);
}
