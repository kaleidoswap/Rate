/** Explicit native implementation gaps. Publication is not execution support. */
export type MakerAsset = 'BTC' | 'ARKD' | 'L-BTC' | 'L-USDT' | 'USDT-RGB';
export interface RouteReadiness { summary: string; requirements: string[] }
export function makerRouteReadiness(from: string, to: string): RouteReadiness {
  const assets = [from, to];
  if (assets.some(a => !['BTC', 'ARKD', 'L-BTC', 'L-USDT', 'USDT-RGB'].includes(a))) {
    return { summary: 'This asset is not supported by this wallet yet.', requirements: ['Validate asset identity, units and network', 'Implement native signing and durable claim/refund recovery'] };
  }
  if (assets.includes('ARKD')) return { summary: 'This Arkade direction is not available from the provider right now.', requirements: ['Matching Arkade Intents market'] };
  const requirements = ['Native HTLC signing and script validation', 'Persist recovery before funding', 'Verify chain evidence before claiming or refunding', 'Resume after restart without funding twice'];
  let summary = 'Bitcoin on-chain swaps are not ready in this app yet.';
  if (assets.some(a => a.startsWith('L-'))) {
    summary = 'Liquid swaps are not ready in this app yet.';
    requirements.push('Native Liquid confidential transaction signing', 'Verify Liquid asset IDs, blinding and fee asset');
  }
  if (assets.includes('USDT-RGB')) {
    summary = 'RGB asset swaps are not ready in this app yet.';
    requirements.push('Validate RGB contract, precision and consignment', 'Persist RGB transfer and refund recovery');
  }
  return { summary, requirements };
}
