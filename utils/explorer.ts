import { mempoolTxUrl, type MempoolNetwork } from '../services/mempool/MempoolClient';
import type { ActivityItem } from '../services/ActivityService';

const TXID = /^[0-9a-f]{64}$/i;

/**
 * The explorer page for an on-chain item's transaction, or null without one
 * (Lightning and L2 items, regtest, an unknown network or a non-txid id).
 */
export function activityExplorerUrl(item: Pick<ActivityItem, 'layer' | 'txid' | 'network' | 'account'>): string | null {
  if ((item.layer !== 'L1' && item.layer !== 'RGB-L1') || !TXID.test(item.txid)) return null;
  const net = String(item.network ?? '').trim().toLowerCase();
  // The RGB account names networks as the node does: "signet" is Mutinynet, "testnet" is testnet3.
  const rgb = item.account === 'RGB' || item.layer === 'RGB-L1';
  if (net === 'testnet3' || (rgb && net === 'testnet')) return `https://mempool.space/testnet/tx/${item.txid}`;
  const site = mempoolNetworkFor(net, rgb);
  return site ? mempoolTxUrl(item.txid, site) : null;
}

/** The mempool site for a network name; the RGB account calls Mutinynet "signet". */
export function mempoolNetworkFor(network: string | undefined | null, rgb: boolean): MempoolNetwork | null {
  const site: Record<string, MempoolNetwork> = {
    mainnet: 'mainnet',
    bitcoin: 'mainnet',
    testnet: 'testnet',
    testnet4: 'testnet',
    signet: rgb ? 'mutinynet' : 'signet',
    mutinynet: 'mutinynet',
  };
  return site[String(network ?? '').trim().toLowerCase()] ?? null;
}
