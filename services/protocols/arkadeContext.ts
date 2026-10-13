import type { Wallet, NetworkName } from '@arkade-os/sdk';
import { protocolManager } from './index';
export function arkadeContext(): { wallet: Wallet; network: NetworkName } {
  const adapter: any = protocolManager.getAdapterIfAvailable('ARKADE');
  if (!adapter?.isConnected()) throw new Error('Connect Arkade first.');
  const network = adapter.arkInfo?.network;
  if (!['bitcoin', 'testnet', 'signet', 'mutinynet', 'regtest'].includes(network)) throw new Error('Arkade network is unknown.');
  return { wallet: adapter.rawWallet, network };
}
