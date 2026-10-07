import type { ActivityLayer } from '../services/ActivityService';

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
