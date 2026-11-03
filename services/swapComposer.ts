import type { MakerCatalog, MakerRoute } from './makerRoutes';
import { estimateLightningSend, estimateLightningReceive } from './kaleidoPay/arkadeIntents';
export type SwapAsset = 'Bitcoin' | 'USDT';
export type SwapNetwork = 'Arkade' | 'Lightning' | 'Bitcoin on-chain' | 'Liquid' | 'RGB';
export interface SwapLeg { asset: SwapAsset; network: SwapNetwork }
export const legNetworks = (asset: SwapAsset): SwapNetwork[] => asset === 'Bitcoin' ? ['Arkade', 'Lightning', 'Bitcoin on-chain', 'Liquid'] : ['Liquid', 'RGB'];
const code = (l: SwapLeg) => l.asset === 'USDT' ? l.network === 'RGB' ? 'USDT-RGB' : 'L-USDT' : l.network === 'Arkade' ? 'ARKD' : l.network === 'Liquid' ? 'L-BTC' : 'BTC';
export function composerRoute(c: MakerCatalog | undefined, from: SwapLeg, to: SwapLeg): MakerRoute | undefined {
  if (from.asset === to.asset && from.network === to.network) return undefined;
  if (from.network === 'Lightning' && to.network === 'Lightning') return undefined;
  const kind = from.network === 'Lightning' ? 'reverse' : to.network === 'Lightning' ? 'submarine' : 'chain';
  return c?.routes.find(r => r.kind === kind && r.fromAsset === code(from) && r.toAsset === code(to));
}
export function composerEstimate(route: MakerRoute | undefined, amount: string) {
  const sats = /^\d+$/.test(amount) ? Number(amount) : NaN;
  if (!Number.isSafeInteger(sats) || sats <= 0) return { error: 'Enter a whole-satoshi amount.' };
  if (!route?.action || !route.intentsMarket) return { error: route?.reason ?? 'No quote is available for this combination.' };
  if (sats < route.min || sats > route.max) return { error: `Amount must be between ${route.min.toLocaleString()} and ${route.max.toLocaleString()} sats.` };
  const estimate = route.action === 'send-arkade' ? estimateLightningSend(route.intentsMarket, sats) : estimateLightningReceive(route.intentsMarket, sats);
  if ('unavailable' in estimate) return { error: estimate.unavailable };
  const total = 'payAmountSat' in estimate ? estimate.payAmountSat : sats + estimate.feeSat;
  return { sats, total, fee: total - sats };
}
