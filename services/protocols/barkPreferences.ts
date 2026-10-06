import DatabaseService from '../DatabaseService';
import { barkWalletKey, BARK_DEFAULT_ENDPOINTS, resolveBarkHostConfig, type BarkHostConfig, type BarkNetwork } from './bark';

const key = (mnemonic: string) => `bark-network-v1-${barkWalletKey(mnemonic)}`;
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

export async function setBarkOff(mnemonic: string): Promise<void> {
  await DatabaseService.getInstance().setSetting(key(mnemonic), OFF);
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
