/**
 * Which accounts a wallet uses
 * ----------------------------
 * One place for the choice made at setup (and restore), and changed later in
 * Settings: Spark and Arkade are wallet networks (stored with the wallet), Bark
 * and RGB on this phone are per-wallet preferences, and the RGB node is a
 * separate NWC connection.
 *
 * Setup and restore both start with Spark and on-device RGB selected.
 */
import type { NetworkConfig } from '../DatabaseService';
import { buildDefaultNetworkConfig } from './networkConfig';
import { BARK_ENABLED } from './bark';
import { saveBarkNetwork, setBarkOff } from './barkPreferences';
import { RGB_L1_DEFAULT_NETWORK, RGB_L1_ENABLED, pinnedRgbL1Network, saveRgbL1Network } from './rgbL1';

export interface AccountChoice {
  spark: boolean;
  arkade: boolean;
  bark: boolean;
  /** RGB on this phone (rgb-lib); the RGB node is connected separately over NWC. */
  rgbOnDevice: boolean;
}

export const SETUP_ACCOUNTS: { key: keyof AccountChoice; name: string; desc: string; icon: string }[] = [
  { key: 'spark', name: 'Spark', desc: 'Instant bitcoin, Lightning and tokens', icon: 'spark' },
  ...(RGB_L1_ENABLED ? [{ key: 'rgbOnDevice' as const, name: 'RGB on-chain', desc: 'RGB assets on-chain, no node needed · beta', icon: 'rgb' }] : []),
  { key: 'arkade', name: 'Arkade', desc: 'Low-fee bitcoin payments off-chain', icon: 'arkade' },
  ...(BARK_ENABLED ? [{ key: 'bark' as const, name: 'Bark', desc: 'Bitcoin on Second’s Ark network', icon: 'bark' }] : []),
];

export const DEFAULT_ACCOUNTS: AccountChoice = { spark: true, arkade: false, bark: false, rgbOnDevice: RGB_L1_ENABLED };

/** The wallet networks to store with a new wallet. */
export function walletNetworksFor(choice: AccountChoice): Omit<NetworkConfig, 'id' | 'wallet_id'>[] {
  return [
    ...(choice.spark ? [{ type: 'spark' as const, enabled: true, config: buildDefaultNetworkConfig('spark') }] : []),
    ...(choice.arkade ? [{ type: 'arkade' as const, enabled: true, config: buildDefaultNetworkConfig('arkade') }] : []),
  ];
}

/**
 * Saves the per-wallet choices. Call before the wallet's first connect, so an
 * account the user left out never starts (Bark defaults to on otherwise).
 */
export async function saveAccountPreferences(mnemonic: string, choice: AccountChoice): Promise<void> {
  if (BARK_ENABLED) {
    if (choice.bark) await saveBarkNetwork(mnemonic, 'mainnet');
    else await setBarkOff(mnemonic);
  }
  if (RGB_L1_ENABLED) {
    // Mainnet like the other accounts, unless this phone already holds this seed's RGB data on another network.
    const network = choice.rgbOnDevice ? (await pinnedRgbL1Network(mnemonic)) ?? RGB_L1_DEFAULT_NETWORK : null;
    await saveRgbL1Network(mnemonic, network);
  }
}

export function hasAnyAccount(choice: AccountChoice, rgbNodeConnected = false): boolean {
  return choice.spark || choice.arkade || choice.bark || choice.rgbOnDevice || rgbNodeConnected;
}
