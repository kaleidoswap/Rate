import {
  discoverOffers, rankedReverseQuotes, startAttempt, payAttempt, resumeAttempt, Esplora, ESPLORA,
} from '@universal-bolt12/swap-market';
import type {
  AttemptDeps, AttemptStore, LightningPayer, SecretStore, SwapAttempt, SwapOffer, SwapQuote,
} from '@universal-bolt12/swap-market';
import type { Route, WalletSource } from '@universal-bolt12/universal-code';
import type { PayAccount, Preview, Quote } from './index';

const OFFER_TTL_MS = 60_000;
/** Per-provider reply budget; providers are asked in parallel, so a quote takes at most this long. */
const QUOTE_REPLY_MS = 10_000;

/** Result shape of the KaleidoPay pay flow (`execute` / `status`). */
export interface PaymentResult { status: 'completed' | 'pending' | 'unknown' | 'failed'; reference?: string }

export function paymentResult(a: SwapAttempt | null | undefined): PaymentResult {
  if (!a) return { status: 'unknown' };
  if (a.stage === 'claimed') return { status: 'completed', reference: a.claim?.txid };
  if (a.stage === 'failed') return { status: 'failed', reference: a.id };
  if (a.stage === 'recoverable') return { status: 'unknown', reference: a.id };
  return { status: 'pending', reference: a.lockup?.txid ?? a.id };
}

export type ElectrumSwapAccount = PayAccount & {
  name: string;
  providerNames: Record<string, string>;
  /** Starts paying an approved quote and returns once the invoices are on their way. */
  execute: (preview: Preview, route: Route, quote: Quote, attemptId: string) => Promise<PaymentResult>;
  status: (attemptId: string) => Promise<PaymentResult>;
};

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
}): ElectrumSwapAccount {
  const { network } = opts.source;
  const to = `btc:${network}`;
  const esplora = new Esplora(ESPLORA[network]);
  const deps: AttemptDeps = { attempts: opts.attempts, secrets: opts.secrets, esplora, zeroConf: opts.zeroConf };
  let offers: { at: number; list: SwapOffer[] } | null = null;
  const agreed = new Map<string, SwapAttempt>();
  const running = new Map<string, { swapId: string; latest: SwapAttempt }>();

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
    name: 'Lightning → on-chain swap',
    providerNames: { 'electrum-nostr': 'Electrum swap providers (Nostr)' },
    source: opts.source,
    swaps: [{ id: 'electrum-nostr', from: opts.source.rail, to, network }],

    // Agrees the swap here, so the quote comes from a provider that answered and its terms
    // are already verified. Nothing is paid; an unpaid swap simply expires at the provider.
    async quote(preview, route): Promise<Quote> {
      const destination = check(preview, route);
      const list = await currentOffers();
      const ranked: SwapQuote[] = rankedReverseQuotes(list, network, preview.request.amountSat, await esplora.feeRate());
      if (!ranked.length) throw new Error('No swap provider can take this amount right now.');
      const tries = await Promise.allSettled(ranked.slice(0, 4).map(q => {
        const offer = list.find(o => o.pubkey === q.provider);
        if (!offer) return Promise.reject(new Error('offer gone'));
        return startAttempt({ quote: q, offer, destination, requestId: preview.request.id, relays: opts.relays, timeoutMs: QUOTE_REPLY_MS }, deps);
      }));
      const answered = tries.flatMap(t => (t.status === 'fulfilled' ? [t.value] : []));
      if (!answered.length) {
        const first = tries.find((t): t is PromiseRejectedResult => t.status === 'rejected');
        throw first?.reason ?? new Error('No swap provider answered.');
      }
      const attempt = answered.sort((x, y) => x.quote.payerSat - y.quote.payerSat)[0];
      agreed.set(preview.request.id, attempt);
      const q = attempt.quote;
      // The claim pays onchain - claim fee; rounding can leave the receiver a sat or two over.
      return { recipientSat: preview.request.amountSat, totalSat: q.payerSat, feeSat: q.payerSat - preview.request.amountSat, expiresAt: q.expiresAt };
    },

    async pay(preview, route, quote, onUpdate) {
      check(preview, route);
      const attempt = agreed.get(preview.request.id);
      if (!attempt || attempt.stage !== 'created') throw new Error('Review the payment again to get a fresh quote.');
      if (attempt.quote.payerSat !== quote.totalSat) throw new Error('The swap no longer matches the approved total. Review the payment again.');
      agreed.delete(preview.request.id);
      return payAttempt(attempt, opts.payer, { ...deps, onUpdate });
    },

    async execute(preview, route, quote, attemptId) {
      const existing = running.get(attemptId);
      if (existing) return paymentResult(existing.latest);
      const total = quote.totalSat;
      const attempt = agreed.get(preview.request.id);
      if (!attempt || attempt.stage !== 'created') throw new Error('Review the payment again to get a fresh quote.');
      if (attempt.quote.payerSat !== total) throw new Error('The swap no longer matches the approved total. Review the payment again.');
      check(preview, route);
      agreed.delete(preview.request.id);
      const entry = { swapId: attempt.id, latest: attempt as SwapAttempt };
      running.set(attemptId, entry);
      // Runs until claimed; the screen polls status().
      payAttempt(attempt, opts.payer, { ...deps, onUpdate: a => { entry.latest = a; } })
        .then(a => { entry.latest = a; })
        .catch(e => { entry.latest = { ...entry.latest, stage: 'recoverable', error: String(e?.message ?? e) }; });
      return { status: 'pending', reference: attempt.id };
    },

    async status(attemptId) {
      const entry = running.get(attemptId);
      if (!entry) return { status: 'unknown' };
      if (entry.latest.stage === 'claimed' || entry.latest.stage === 'failed') return paymentResult(entry.latest);
      return paymentResult((await opts.attempts.load(entry.swapId)) ?? entry.latest);
    },
  };
}

/** Finishes swaps interrupted by an app restart. Never pays again. */
export async function resumeKaleidoPaySwaps(deps: AttemptDeps): Promise<SwapAttempt[]> {
  const open = (await deps.attempts.list()).filter(a => !['claimed', 'failed'].includes(a.stage));
  return Promise.all(open.map(a => resumeAttempt(a, { ...deps, esplora: new Esplora(ESPLORA[a.swap.network]) })));
}
