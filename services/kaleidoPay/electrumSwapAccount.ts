import {
  discoverOffers, rankedReverseQuotes, startAttempt, payAttempt, resumeAttempt, Esplora, ESPLORA,
} from '@universal-bolt12/swap-market';
import type {
  AttemptDeps, AttemptStore, LightningPayer, SecretStore, SwapAttempt, SwapOffer, SwapQuote,
} from '@universal-bolt12/swap-market';
import type { Route, WalletSource } from '@universal-bolt12/universal-code';
import type { AccountQuoteOption, PayAccount, Preview, Quote } from './index';
import { PaymentNotSentError } from './errors';

const OFFER_TTL_MS = 60_000;
/** Per-provider reply budget; providers are asked in parallel, so a quote takes at most this long. */
const QUOTE_REPLY_MS = 10_000;

/** Result shape of the KaleidoPay pay flow (`execute` / `status`). */
export interface PaymentResult { status: 'completed' | 'pending' | 'unknown' | 'failed'; reference?: string }

export function paymentResult(a: SwapAttempt | null | undefined): PaymentResult {
  if (!a) return { status: 'unknown' };
  if (a.stage === 'claimed') return { status: 'completed', reference: a.claim?.txid };
  if (a.stage === 'failed') return { status: a.error === 'never paid' ? 'failed' : 'unknown', reference: a.id };
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
  const agreed = new WeakMap<Quote, { attempt: SwapAttempt; terms: string }>();
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

  const terms = (preview: Preview, route: Route) => JSON.stringify({ request: preview.request, code: preview.code, route });
  function approved(preview: Preview, route: Route, quote: Quote) {
    check(preview, route);
    const value = agreed.get(quote);
    if (!value || value.terms !== terms(preview, route) || value.attempt.quote.payerSat !== quote.totalSat) throw new Error('The swap no longer matches the approved total or destination. Review the payment again.');
    if (value.attempt.stage !== 'created' || quote.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('Review the payment again to get a fresh quote.');
    return value.attempt;
  }
  async function quoteOptions(preview: Preview, route: Route): Promise<AccountQuoteOption[]> {
    const destination = check(preview, route);
    const list = await currentOffers();
    const ranked: SwapQuote[] = rankedReverseQuotes(list, network, preview.request.amountSat, await esplora.feeRate());
    if (!ranked.length) throw new Error('No swap provider can take this amount right now.');
    return Promise.all(ranked.slice(0, 4).map(async q => {
      const offer = list.find(o => o.pubkey === q.provider);
      const option: AccountQuoteOption = { id: q.provider, name: 'Electrum swap', detail: `${q.provider.slice(0, 6)}…${q.provider.slice(-4)}` };
      try {
        if (!offer) throw new Error('Provider offer no longer available.');
        const attempt = await startAttempt({ quote: q, offer, destination, requestId: preview.request.id, relays: opts.relays, timeoutMs: QUOTE_REPLY_MS }, deps);
        option.quote = { recipientSat: preview.request.amountSat, totalSat: attempt.quote.payerSat, feeSat: attempt.quote.payerSat - preview.request.amountSat, expiresAt: attempt.quote.expiresAt };
        agreed.set(option.quote, { attempt, terms: terms(preview, route) });
      } catch (e) { option.unavailable = e instanceof Error ? e.message : 'Provider did not respond.'; }
      return option;
    }));
  }

  return {
    name: 'Lightning → on-chain swap',
    providerNames: { 'electrum-nostr': 'Electrum swap providers (Nostr)' },
    source: opts.source,
    swaps: [{ id: 'electrum-nostr', from: opts.source.rail, to, network }],
    quoteOptions,
    async quote(preview, route) {
      const options = await quoteOptions(preview, route);
      const quotes = options.flatMap(o => o.quote ? [o.quote] : []).sort((a, b) => a.totalSat! - b.totalSat!);
      if (!quotes.length) throw new Error(options[0]?.unavailable ?? 'No swap provider answered.');
      return quotes[0];
    },

    async pay(preview, route, quote, onUpdate) {
      let attempt: ReturnType<typeof approved>;
      try { attempt = approved(preview, route, quote); }
      catch (error) { throw new PaymentNotSentError(error instanceof Error ? error.message : 'Review the payment again.'); }
      agreed.delete(quote);
      return payAttempt(attempt, opts.payer, { ...deps, onUpdate });
    },

    async execute(preview, route, quote, attemptId) {
      const existing = running.get(attemptId);
      if (existing) return paymentResult(existing.latest);
      let attempt: ReturnType<typeof approved>;
      try { attempt = approved(preview, route, quote); }
      catch (error) { throw new PaymentNotSentError(error instanceof Error ? error.message : 'Review the payment again.'); }
      const recoveryId = `${opts.source.id}:${attemptId}`;
      const prior = (await opts.attempts.list()).find(a => a.requestId === recoveryId);
      if (prior) return paymentResult(prior); // Never fund an already journaled attempt again.
      agreed.delete(quote);
      attempt.requestId = recoveryId;
      await opts.attempts.save(attempt); // Persist UI-to-swap recovery mapping BEFORE paying.
      const entry = { swapId: attempt.id, latest: attempt as SwapAttempt };
      running.set(attemptId, entry);
      // Runs until claimed; the screen polls status().
      payAttempt(attempt, opts.payer, { ...deps, onUpdate: a => { entry.latest = a; } })
        .then(a => { entry.latest = a; })
        .catch(e => { entry.latest = { ...entry.latest, stage: 'recoverable', error: String(e?.message ?? e) }; });
      return { status: 'pending', reference: attempt.id };
    },

    async status(attemptId) {
      let entry = running.get(attemptId);
      if (!entry) {
        const saved = (await opts.attempts.list()).find(a => a.requestId === `${opts.source.id}:${attemptId}`);
        if (!saved) return { status: 'unknown' };
        entry = { swapId: saved.id, latest: saved };
        running.set(attemptId, entry);
        if (!['claimed', 'failed'].includes(saved.stage)) {
          const recovering = entry;
          // Resume only watches/claims a funded swap; it never pays the invoices again.
          void resumeAttempt(saved, { ...deps, onUpdate: a => { recovering.latest = a; } })
            .then(a => { recovering.latest = a; })
            .catch(() => { recovering.latest = { ...recovering.latest, stage: 'recoverable' }; });
        }
      }
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
