import AsyncStorage from '@react-native-async-storage/async-storage';
import { decodeOffer } from '@universal-bolt12/universal-code';
import type { Network, Route } from '@universal-bolt12/universal-code';
import { validFeeSats } from '../paymentReview';
import { createElectrumSwapAccount } from './electrumSwapAccount';
import { registerKaleidoPayAccount } from './index';
import type { AccountQuoteOption, PayAccount, PaymentResult, Preview, Quote } from './index';
import { lightningPayerFrom } from './lightningPayer';
import type { LightningSender } from './lightningPayer';
import { kaleidoPayStores } from './recovery';

/** Bark adapter surface: Lightning sends (BOLT11 and BOLT12 offers) plus the backend's fee estimate. */
export interface BarkPaySender extends LightningSender {
  backend?: { estimatePaymentFee(kind: 'lightning', amount: number): Promise<{ feeSats: number }> };
}

let disconnect: (() => void) | null = null;
const FEE_UNAVAILABLE = 'Bark did not return a fee estimate, so a complete payment quote is not available.';
const QUOTE_TTL_S = 120;

function resultOf(r: { paymentHash: string; status: string } | null | undefined): PaymentResult {
  if (!r) return { status: 'unknown' };
  const reference = r.paymentHash || undefined;
  if (r.status === 'confirmed' || r.status === 'completed') return { status: 'completed', reference };
  if (r.status === 'failed') return { status: 'failed', reference };
  if (r.status === 'pending') return { status: 'pending', reference };
  return { status: 'unknown', reference };
}

export function createBarkPayAccount(bark: BarkPaySender, network: Network): PayAccount {
  const swap = createElectrumSwapAccount({
    source: { id: 'bark', rail: 'ln', network },
    payer: lightningPayerFrom(bark),
    ...kaleidoPayStores,
  });
  const swapQuotes = new WeakMap<Quote, Quote>(); // our total (provider + Bark fees) -> provider quote
  const offerQuotes = new WeakMap<Quote, { offer: string; fixedAmount: boolean }>();
  const offerRef = (attemptId: string) => `kaleidopay-bark-offer-${attemptId}`;

  async function barkFee(amount: number): Promise<number | null> {
    try { return validFeeSats((await bark.backend?.estimatePaymentFee('lightning', amount))?.feeSats); } catch { return null; }
  }

  async function swapOptions(preview: Preview, route: Route): Promise<AccountQuoteOption[]> {
    return Promise.all((await swap.quoteOptions!(preview, route)).map(async option => {
      if (!option.quote) return option;
      const inner = option.quote;
      // The provider bills a hold invoice and a prepayment; Bark charges per payment.
      const fees = [await barkFee(inner.totalSat!), await barkFee(Math.min(inner.totalSat!, 1000))];
      if (fees.some(f => f === null)) return { id: option.id, name: option.name, unavailable: FEE_UNAVAILABLE };
      const extra = fees.reduce<number>((a, b) => a + (b ?? 0), 0);
      const quote: Quote = { recipientSat: inner.recipientSat, totalSat: inner.totalSat! + extra, feeSat: inner.feeSat! + extra, expiresAt: inner.expiresAt };
      swapQuotes.set(quote, inner);
      return { id: option.id, name: option.name, quote };
    }));
  }

  async function offerQuote(preview: Preview): Promise<Quote> {
    const offer = preview.code.offer;
    if (!offer) throw new Error('Bark pays Lightning directly only for BOLT12 offers here.');
    const fee = await barkFee(preview.request.amountSat);
    if (fee === null) throw new Error(FEE_UNAVAILABLE);
    const quote: Quote = { recipientSat: preview.request.amountSat, feeSat: fee, totalSat: preview.request.amountSat + fee,
      expiresAt: Math.floor(Date.now() / 1000) + QUOTE_TTL_S };
    offerQuotes.set(quote, { offer, fixedAmount: decodeOffer(offer).some(f => f.type === 8n) });
    return quote;
  }

  return {
    source: swap.source,
    name: 'Bark',
    swaps: swap.swaps,
    providerNames: swap.providerNames,

    async quoteOptions(preview, route) {
      if (route.kind === 'direct') {
        try { return [{ id: 'bark-offer', name: 'Bark · Lightning', quote: await offerQuote(preview) }]; }
        catch (e) { return [{ id: 'bark-offer', name: 'Bark · Lightning', unavailable: e instanceof Error ? e.message : FEE_UNAVAILABLE }]; }
      }
      return swapOptions(preview, route);
    },

    async quote(preview, route) {
      if (route.kind === 'direct') return offerQuote(preview);
      const quotes = (await swapOptions(preview, route)).flatMap(o => o.quote ? [o.quote] : []);
      if (!quotes.length) throw new Error('No swap provider gave a complete quote.');
      return quotes.sort((a, b) => a.totalSat! - b.totalSat!)[0];
    },

    async execute(preview, route, quote, attemptId) {
      if (route.kind === 'direct') {
        const saved = offerQuotes.get(quote);
        if (!saved || saved.offer !== preview.code.offer || quote.expiresAt <= Math.floor(Date.now() / 1000)) {
          throw new Error('Review the payment again to get a fresh quote.');
        }
        offerQuotes.delete(quote);
        const result = await bark.sendPayment({ invoice: saved.offer, amount: saved.fixedAmount ? undefined : quote.recipientSat });
        await AsyncStorage.setItem(offerRef(attemptId), JSON.stringify(result));
        return resultOf(result);
      }
      const inner = swapQuotes.get(quote);
      if (!inner) throw new Error('Review the payment again to get a fresh quote.');
      swapQuotes.delete(quote);
      return swap.execute!(preview, route, inner, attemptId);
    },

    async status(attemptId) {
      const raw = await AsyncStorage.getItem(offerRef(attemptId));
      if (!raw) return swap.status!(attemptId);
      const saved = JSON.parse(raw) as { paymentHash: string; status: string };
      if (saved.status !== 'pending' || !saved.paymentHash) return resultOf(saved);
      return resultOf({ paymentHash: saved.paymentHash, status: (await bark.getPaymentStatus(saved.paymentHash)).status });
    },
  };
}

export function connectBarkToKaleidoPay(bark: BarkPaySender, network: Network): void {
  disconnect?.();
  disconnect = registerKaleidoPayAccount(createBarkPayAccount(bark, network));
}

export function disconnectBarkFromKaleidoPay(): void {
  disconnect?.();
  disconnect = null;
}
