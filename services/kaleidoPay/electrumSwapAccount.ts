import {
  discoverOffers, rankedReverseQuotes, startAttempt, payAttempt, resumeAttempt, Esplora, ESPLORA,
} from '@universal-bolt12/swap-market';
import type {
  AttemptDeps, AttemptStore, LightningPayer, SecretStore, SwapAttempt, SwapOffer, SwapQuote,
} from '@universal-bolt12/swap-market';
import type { Route, WalletSource } from '@universal-bolt12/universal-code';
import type { PayAccount, Preview, Quote } from './index';

const OFFER_TTL_MS = 60_000;

/**
 * A KaleidoPay account that pays bitcoin addresses from Lightning through Electrum's
 * swap providers on Nostr. `payer` is the wallet's Lightning sender (Bark in the demo).
 */
export function createElectrumSwapAccount(opts: {
  source: WalletSource;
  payer: LightningPayer;
  attempts: AttemptStore;
  secrets: SecretStore;
  relays?: string[];
  zeroConf?: boolean;
}): PayAccount {
  const { network } = opts.source;
  const to = `btc:${network}`;
  const esplora = new Esplora(ESPLORA[network]);
  const deps: AttemptDeps = { attempts: opts.attempts, secrets: opts.secrets, esplora, zeroConf: opts.zeroConf };
  let offers: { at: number; list: SwapOffer[] } | null = null;
  const agreed = new Map<string, SwapAttempt>();

  async function currentOffers(): Promise<SwapOffer[]> {
    if (!offers || Date.now() - offers.at > OFFER_TTL_MS) {
      offers = { at: Date.now(), list: await discoverOffers({ network, relays: opts.relays }) };
    }
    return offers.list;
  }

  function check(preview: Preview, route: Route): string {
    if (route.kind !== 'swap' || route.to !== to || route.sourceId !== opts.source.id) throw new Error('This account only pays bitcoin addresses through a swap.');
    if (!preview.code.address) throw new Error('The request has no bitcoin address.');
    return preview.code.address;
  }

  return {
    source: opts.source,
    swaps: [{ id: 'electrum-nostr', from: opts.source.rail, to, network }],

    // Agrees the swap here, so the quote comes from a provider that answered and its terms
    // are already verified. Nothing is paid; an unpaid swap simply expires at the provider.
    async quote(preview, route): Promise<Quote> {
      const destination = check(preview, route);
      const list = await currentOffers();
      const ranked: SwapQuote[] = rankedReverseQuotes(list, network, preview.request.amountSat, await esplora.feeRate());
      if (!ranked.length) throw new Error('No swap provider can take this amount right now.');
      let lastError: unknown = null;
      for (const q of ranked.slice(0, 4)) {
        const offer = list.find(o => o.pubkey === q.provider);
        if (!offer) continue;
        try {
          const attempt = await startAttempt({ quote: q, offer, destination, requestId: preview.request.id, relays: opts.relays }, deps);
          agreed.set(preview.request.id, attempt);
          // The claim pays onchain - claim fee; rounding can leave the receiver a sat or two over.
          return { recipientSat: preview.request.amountSat, totalSat: q.payerSat, feeSat: q.payerSat - preview.request.amountSat, expiresAt: q.expiresAt };
        } catch (e) {
          lastError = e; // provider silent or refused: try the next one
        }
      }
      throw lastError ?? new Error('No swap provider answered.');
    },

    async pay(preview, route, quote, onUpdate) {
      check(preview, route);
      const attempt = agreed.get(preview.request.id);
      if (!attempt || attempt.stage !== 'created') throw new Error('Review the payment again to get a fresh quote.');
      if (attempt.quote.payerSat !== quote.totalSat) throw new Error('The swap no longer matches the approved total. Review the payment again.');
      agreed.delete(preview.request.id);
      return payAttempt(attempt, opts.payer, { ...deps, onUpdate });
    },
  };
}

/** Finishes swaps interrupted by an app restart. Never pays again. */
export async function resumeKaleidoPaySwaps(deps: AttemptDeps): Promise<SwapAttempt[]> {
  const open = (await deps.attempts.list()).filter(a => !['claimed', 'failed'].includes(a.stage));
  return Promise.all(open.map(a => resumeAttempt(a, { ...deps, esplora: new Esplora(ESPLORA[a.swap.network]) })));
}
