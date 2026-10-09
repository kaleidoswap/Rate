import type { ActivityItem, ActivityLayer } from '../services/ActivityService';
import { AGENT_ACTIVITY_KIND } from '../services/agentWallet/activity';

/** How each activity layer is named in chips and details. */
export const LAYER_LABEL: Record<ActivityLayer, string> = {
  'L1': 'On-chain',
  'RGB-L1': 'RGB',
  'LN': 'Lightning',
  'RGB-LN': 'RGB · LN',
  'Spark': 'Spark',
  'Arkade': 'Arkade',
  'Bark': 'Bark',
  'Bark Signet': 'Bark · Signet',
  'Swap': 'Swap',
  'Cross-chain': 'Cross-chain',
};

/** The NetworkIcon for a layer; null when it has none (swaps span two). */
export function layerNetworkIcon(layer: ActivityLayer): string | null {
  switch (layer) {
    case 'L1': return 'onchain';
    case 'LN': return 'lightning';
    case 'RGB-L1':
    case 'RGB-LN': return 'rgb';
    case 'Spark': return 'spark';
    case 'Arkade': return 'arkade';
    case 'Bark':
    case 'Bark Signet': return 'bark';
    default: return null;
  }
}

export type ActivityNetwork = 'onchain' | 'lightning' | 'spark' | 'arkade' | 'bark' | 'rgb';

const NETWORK_ORDER: ActivityNetwork[] = ['onchain', 'lightning', 'spark', 'arkade', 'bark', 'rgb'];

export const ACTIVITY_NETWORK_LABEL: Record<ActivityNetwork, string> = {
  onchain: 'On-chain',
  lightning: 'Lightning',
  spark: 'Spark',
  arkade: 'Arkade',
  bark: 'Bark',
  rgb: 'RGB',
};

/** The network a layer is filtered under; null for swaps and cross-chain orders. */
export function activityNetwork(layer: ActivityLayer): ActivityNetwork | null {
  switch (layer) {
    case 'L1': return 'onchain';
    case 'LN': return 'lightning';
    case 'RGB-L1':
    case 'RGB-LN': return 'rgb';
    case 'Spark': return 'spark';
    case 'Arkade': return 'arkade';
    case 'Bark':
    case 'Bark Signet': return 'bark';
    default: return null;
  }
}

/** The networks present in a list, in a fixed order. */
export function activityNetworks(items: { layer: ActivityLayer }[]): ActivityNetwork[] {
  const present = new Set(items.map((i) => activityNetwork(i.layer)));
  return NETWORK_ORDER.filter((n) => present.has(n));
}

export type ActivityTab = 'pending' | 'all' | 'receive' | 'send' | 'swap' | 'agent';

/** Whether an item shows under a tab and a network ('all' for every network). */
export function matchesActivityFilter(
  item: Pick<ActivityItem, 'type' | 'status' | 'layer'> & { kind?: string },
  tab: ActivityTab,
  network: ActivityNetwork | 'all' = 'all',
): boolean {
  if (network !== 'all' && activityNetwork(item.layer) !== network) return false;
  if (tab === 'agent') return item.kind === AGENT_ACTIVITY_KIND;
  if (tab === 'pending') return item.status === 'pending' || item.status === 'unknown';
  if (tab === 'all') return true;
  return item.type === tab;
}
