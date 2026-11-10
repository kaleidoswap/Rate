import type { Network, PaymentOffer } from './kaleidoPay';
import { isLightningSendMarket, isLightningReceiveMarket, type IntentsMarket } from './kaleidoPay/arkadeIntents';

export interface MakerRoute {
  id: string; kind: 'submarine' | 'reverse' | 'chain'; from: string; to: string;
  pairId: string; min: number; max: number; feePercent: number;
  action?: 'send-arkade' | 'receive-arkade'; reason?: string;
}
export interface MakerCatalog { url: string; network: Network; routes: MakerRoute[]; checkedAt: number; halted: boolean }
const DEFAULT_MAKER = 'https://maker.signet.kaleidoswap.com';
export function makerRoot(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS maker URL without credentials.');
  return url.href.replace(/\/v2\/?$/, '').replace(/\/$/, '');
}
export function makerNetworkMatches(url: string, advertised: unknown, network: Network): boolean {
  // This host runs custom signet (Mutinynet), not public Signet or Testnet.
  if (makerRoot(url) === DEFAULT_MAKER) return network === 'mutinynet' && advertised === 'signet';
  return advertised === network || (network === 'mainnet' && advertised === 'bitcoin');
}
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const label = (asset: string, layer: string) => asset === 'ARKD' ? 'Bitcoin · Arkade' : asset === 'BTC' ? `Bitcoin · ${layer}` : asset === 'USDT-RGB' ? 'USDT · RGB' : `${asset} · Liquid`;
export function parseMakerCatalog(url: string, network: Network, info: any, books: Record<string, any>, card: any): MakerCatalog {
  url = makerRoot(url);
  if (!makerNetworkMatches(url, info?.network, network)) throw new Error('The maker and wallet are on different networks.');
  if (typeof info?.halted !== 'boolean') throw new Error('The maker did not report its availability.');
  const markets: IntentsMarket[] = Array.isArray(card?.markets) ? card.markets : [];
  const routes: MakerRoute[] = [];
  for (const kind of ['submarine', 'reverse', 'chain'] as const) {
    const book = books[kind];
    if (!book || typeof book !== 'object' || Array.isArray(book)) throw new Error('The maker returned an invalid route catalogue.');
    for (const [from, targets] of Object.entries(book)) {
      if (!targets || typeof targets !== 'object' || Array.isArray(targets)) throw new Error('The maker returned invalid destinations.');
      for (const [to, raw] of Object.entries(targets)) {
        const p: any = raw;
        if (!p || typeof p.pairId !== 'string' || !p.pairId || typeof p.hash !== 'string' || !p.hash ||
          !integer(p.limits?.minimal) || !integer(p.limits?.maximal) || p.limits.maximal < p.limits.minimal ||
          !Number.isFinite(p.rate) || p.rate <= 0 || !Number.isFinite(p.fees?.percentage) || p.fees.percentage < 0 || p.fees.percentage >= 100) throw new Error('The maker returned invalid limits or fees.');
        let action: MakerRoute['action'];
        if (kind === 'submarine' && from === 'ARKD' && to === 'BTC' && markets.some(isLightningSendMarket)) action = 'send-arkade';
        if (kind === 'reverse' && from === 'BTC' && to === 'ARKD' && markets.some(isLightningReceiveMarket)) action = 'receive-arkade';
        routes.push({ id: `${kind}:${from}:${to}`, kind, from: label(from, kind === 'reverse' ? 'Lightning' : 'on-chain'), to: label(to, kind === 'submarine' ? 'Lightning' : 'on-chain'),
          pairId: p.pairId, min: p.limits.minimal, max: p.limits.maximal, feePercent: p.fees.percentage,
          action: info.halted ? undefined : action,
          reason: info.halted ? 'The maker has paused swaps.' : action ? undefined : (from === 'ARKD' || to === 'ARKD') ? 'The maker has not enabled this Intents direction.' : 'Native signing and refund recovery are not available for this route yet.' });
      }
    }
  }
  return { url, network, routes, checkedAt: Date.now(), halted: info.halted };
}
export async function loadMakerCatalog(url: string, network: Network, fetcher: typeof fetch = fetch): Promise<MakerCatalog> {
  const root = makerRoot(url);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const get = async (path: string, optional = false) => {
      const r = await fetcher(`${root}${path}`, { signal: controller.signal });
      if (!r.ok) { if (optional) return null; throw new Error(`Maker catalogue unavailable (${r.status}).`); }
      return r.json();
    };
    const [info, submarine, reverse, chain, card] = await Promise.all([get('/v2/info'), get('/v2/swap/submarine'), get('/v2/swap/reverse'), get('/v2/swap/chain'), get('/v1/card', true).catch(() => null)]);
    return parseMakerCatalog(root, network, info, { submarine, reverse, chain }, card);
  } finally { clearTimeout(timer); }
}
/** Restricts the existing reviewed/journalled Send flow to the exact maker route. */
export function makerSendOffers(offers: PaymentOffer[], network: Network): PaymentOffer[] {
  return offers.filter(o => o.route.kind === 'swap' && o.route.sourceId === 'arkade' && o.route.providerId === 'arkade-intents' && o.route.to === `ln:${network}` && o.providerChoiceId === 'kaleidoswap');
}

/** Public UI receipt only; cryptographic recovery remains in the SDK's durable store. */
export function parseMakerReceiveReceipt(raw: string): import('./kaleidoPay/arkadeIntents').ArkadeLightningReceive {
  const r = JSON.parse(raw);
  if (!r || typeof r.rfqId !== 'string' || !r.rfqId || typeof r.invoice !== 'string' || !r.invoice || r.provider !== 'KaleidoSwap' ||
    !integer(r.amountSats) || !integer(r.payAmountSats) || r.payAmountSats < r.amountSats || !integer(r.expiresAt)) throw new Error('Invalid saved maker request');
  return r;
}
