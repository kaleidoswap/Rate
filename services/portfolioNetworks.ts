import type { WalletRecord } from './DatabaseService';
import { loadBarkHost } from './protocols/barkPreferences';
import { LEGACY_NETWORK, resolveSparkNetwork } from './protocols/networkConfig';
import { loadRgbL1Network } from './protocols/rgbL1';
import { chainLabel, type ReceiveChain } from '../utils/receive-routes';
import type { BalanceSnapshot } from './balanceSnapshot';

type Account = 'SPARK' | 'ARKADE' | 'RGB' | 'BARK' | 'LN';
const chains = new Set(['mainnet', 'signet', 'mutinynet', 'testnet', 'regtest']);

/** A pre-0.19.3 cache had no chain labels. Unidentifiable holdings stay off the portfolio until sync. */
export async function qualifySnapshotNetworks(wallet: WalletRecord, snapshot: BalanceSnapshot): Promise<BalanceSnapshot> {
  if (snapshot.testNetworks !== undefined) return snapshot;
  const configured: Partial<Record<Account, ReceiveChain>> = {};
  for (const config of wallet.networks ?? []) {
    if (!config.enabled) continue;
    let network: unknown;
    try { network = JSON.parse(config.config || '{}')?.network ?? LEGACY_NETWORK[config.type]; } catch { continue; }
    if (config.type === 'spark') configured.SPARK = resolveSparkNetwork(typeof network === 'string' ? network : undefined);
    if (typeof network !== 'string' || !chains.has(network)) continue;
    if (config.type === 'arkade') configured.ARKADE = network === 'signet' ? 'mutinynet' : network as ReceiveChain;
    if (config.type === 'rln') configured.LN = network as ReceiveChain;
  }
  const mnemonic = wallet.encrypted_mnemonic;
  const hasRgb = snapshot.byProtocol.RGB || snapshot.channels.length || snapshot.assets.some(asset => !asset.protocol || asset.protocol.startsWith('RGB'));
  const [rgbNetwork, barkHost] = mnemonic ? await Promise.all([
    hasRgb ? loadRgbL1Network(mnemonic).catch(() => null) : null,
    snapshot.byProtocol.BARK ? loadBarkHost(mnemonic).catch(() => null) : null,
  ]) : [null, null];
  // A legacy snapshot with a node and a native wallet is ambiguous until a live read.
  if (rgbNetwork && (!configured.LN || rgbNetwork === configured.LN)) configured.RGB = rgbNetwork;
  if (!rgbNetwork) configured.RGB = configured.LN;
  if (barkHost) configured.BARK = barkHost.network;

  const byProtocol = Object.fromEntries(Object.entries(snapshot.byProtocol).filter(([key]) => configured[key as Account] !== undefined));
  const assets = snapshot.assets.filter(asset => configured[(asset.protocol?.startsWith('RGB') || !asset.protocol ? 'RGB' : asset.protocol) as Account] !== undefined);
  const testNetworks: NonNullable<BalanceSnapshot['testNetworks']> = {};
  for (const account of ['RGB', 'SPARK', 'ARKADE', 'BARK', 'LN'] as const) {
    const network = configured[account];
    if (network && network !== 'mainnet') testNetworks[account] = chainLabel(network);
  }
  return { ...snapshot, byProtocol, assets, channels: configured.RGB ? snapshot.channels : [], testNetworks };
}
