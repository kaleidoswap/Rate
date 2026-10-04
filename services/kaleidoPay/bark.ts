import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode as decodeBolt11Raw } from 'light-bolt11-decoder';
import type { Network, Route } from '@universal-bolt12/universal-code';
import { validFeeSats } from '../paymentReview';
import { createElectrumSwapAccount } from './electrumSwapAccount';
import { offerAmountSat, registerKaleidoPayAccount, registerKaleidoPayPreparer } from './index';
import type { AccountQuoteOption, PayAccount, PaymentResult, Preview, Quote } from './index';
import { PaymentNotSentError } from './errors';
import { lightningPayerFrom } from './lightningPayer';
import type { LightningSender } from './lightningPayer';
import { kaleidoPayStores } from './recovery';
import { throttledSync } from '../../utils/throttled-sync';

/** Bark adapter surface: Lightning sends (BOLT11, BOLT12 offers) and Ark addresses, plus the backend's checks. */
export interface BarkPaySender extends LightningSender {
  backend?: {
    estimatePaymentFee(kind: 'lightning' | 'ark' | 'onchain', amount: number, address?: string): Promise<{ feeSats: number }>;
    isBarkAddress?(address: string): boolean;
    sync?(): Promise<unknown>;
  };
  getConnectionInfo?(): Promise<{ connected: boolean; nodeId?: string; network?: string }>;
  /** Bark's balance; `confirmed` is what it can spend now. Quotes above it are refused. */
  getBtcBalance?(): Promise<{ confirmed: number }>;
}

/** A direct Lightning payment a quote was made for. */
interface DirectPayment {
  kind: 'offer' | 'invoice';
  destination: string;
  /** The offer or invoice fixes the amount, so Bark is not given one. */
  fixedAmount: boolean;
  paymentHash?: string;
  invoiceExpiresAt?: number;
}

let disconnect: (() => void) | null = null;
let generation = 0;
const ARK_INFO_RETRY_MS = [0, 2000, 5000, 10000, 30000, 60000];
const FEE_UNAVAILABLE = 'Bark did not return a fee estimate, so a complete payment quote is not available.';
const QUOTE_TTL_S = 120;

/**
 * Refuses a quote whose total is more than Bark can spend. A balance that can't be read
 * leaves the check to the send itself.
 */
async function assertSpendable(bark: BarkPaySender, totalSat: number): Promise<void> {
  if (!bark.getBtcBalance) return;
  let spendable: number | undefined;
  try { spendable = (await bark.getBtcBalance())?.confirmed; } catch { return; }
  if (typeof spendable === 'number' && Number.isFinite(spendable) && totalSat > spendable) {
    throw new Error(`Not enough in Bark: this payment needs ${totalSat.toLocaleString()} sats including fees, ${spendable.toLocaleString()} sats are spendable.`);
  }
}

interface DecodedInvoice { amountSat?: number; paymentHash?: string; expiresAt?: number }
/** The parts of a BOLT11 invoice Bark's direct send needs; null when it can't be read. */
function readInvoice(invoice: string): DecodedInvoice | null {
  try {
    const d: any = decodeBolt11Raw(invoice.trim());
    const sec = (n: string) => d.sections?.find((s: any) => s.name === n)?.value;
    const msat = sec('amount');
    const timestamp = Number(sec('timestamp'));
    const expiry = Number(sec('expiry') ?? 3600); // BOLT11 default: one hour
    return {
      amountSat: msat ? Math.floor(Number(msat) / 1000) : undefined,
      paymentHash: typeof sec('payment_hash') === 'string' ? sec('payment_hash') : undefined,
      expiresAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp + expiry : undefined,
    };
  } catch { return null; }
}

function resultOf(r: { paymentHash: string; status: string } | null | undefined): PaymentResult {
  if (!r) return { status: 'unknown' };
  const reference = r.paymentHash || undefined;
  if (r.status === 'confirmed' || r.status === 'completed') return { status: 'completed', reference };
  if (r.status === 'failed') return { status: 'failed', reference };
  if (r.status === 'pending') return { status: 'pending', reference };
  return { status: 'unknown', reference };
}

/**
 * Bark runs without its daemon: a Lightning send started with wait:false only settles
 * (and its status only changes) once the wallet syncs, so status checks sync first.
 */
function syncedStatus(bark: BarkPaySender): (hash: string) => ReturnType<BarkPaySender['getPaymentStatus']> {
  const sync = throttledSync(() => bark.backend?.sync?.() ?? Promise.resolve(), 5_000);
  return async hash => {
    await sync().catch(() => undefined);
    return bark.getPaymentStatus(hash);
  };
}

export function createBarkPayAccount(bark: BarkPaySender, network: Network): PayAccount {
  const paymentStatus = syncedStatus(bark);
  const swap = createElectrumSwapAccount({
    source: { id: 'bark', rail: 'ln', network },
    payer: lightningPayerFrom({ sendPayment: request => bark.sendPayment(request), getPaymentStatus: paymentStatus }),
    ...kaleidoPayStores,
  });
  const swapQuotes = new WeakMap<Quote, Quote>(); // our total (provider + Bark fees) -> provider quote
  const directQuotes = new WeakMap<Quote, DirectPayment>();
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
      if (fees.some(f => f === null)) return { id: option.id, name: option.name, detail: option.detail, unavailable: FEE_UNAVAILABLE };
      const extra = fees.reduce<number>((a, b) => a + (b ?? 0), 0);
      const quote: Quote = { recipientSat: inner.recipientSat, totalSat: inner.totalSat! + extra, feeSat: inner.feeSat! + extra, expiresAt: inner.expiresAt };
      try { await assertSpendable(bark, quote.totalSat!); }
      catch (e) { return { id: option.id, name: option.name, detail: option.detail, unavailable: (e as Error).message }; }
      swapQuotes.set(quote, inner);
      return { id: option.id, name: option.name, detail: option.detail, quote };
    }));
  }

  /** Direct Lightning: a BOLT12 offer when the code has one, else its BOLT11 invoice. */
  async function directQuote(preview: Preview): Promise<Quote> {
    const now = Math.floor(Date.now() / 1000);
    const { offer, invoice } = preview.code;
    const amountSat = preview.request.amountSat;
    let saved: DirectPayment;
    if (offer) {
      // Bark pays a fixed-amount offer its own amount, so the quote must be for exactly that.
      const offerSat = offerAmountSat(offer);
      if (offerSat !== undefined && offerSat !== amountSat) {
        throw new Error('The offer asks for a different amount than this payment. Review it again.');
      }
      saved = { kind: 'offer', destination: offer, fixedAmount: offerSat !== undefined };
    } else if (invoice) {
      const decoded = readInvoice(invoice);
      if (!decoded) throw new Error('This Lightning invoice could not be read.');
      if (decoded.expiresAt !== undefined && decoded.expiresAt <= now) throw new Error('This Lightning invoice has expired. Ask for a new one.');
      if (decoded.amountSat !== undefined && decoded.amountSat !== amountSat) {
        throw new Error('The invoice asks for a different amount than this payment. Review it again.');
      }
      saved = { kind: 'invoice', destination: invoice, fixedAmount: decoded.amountSat !== undefined,
        paymentHash: decoded.paymentHash, invoiceExpiresAt: decoded.expiresAt };
    } else {
      throw new Error('Bark pays Lightning directly only for invoices and BOLT12 offers.');
    }
    const fee = await barkFee(amountSat);
    if (fee === null) throw new Error(FEE_UNAVAILABLE);
    await assertSpendable(bark, amountSat + fee);
    const expiresAt = Math.min(now + QUOTE_TTL_S, saved.invoiceExpiresAt ?? Infinity);
    const quote: Quote = { recipientSat: amountSat, feeSat: fee, totalSat: amountSat + fee, expiresAt };
    directQuotes.set(quote, saved);
    return quote;
  }

  const directName = (preview: Preview) => preview.code.offer ? 'Lightning (BOLT12)' : 'Lightning';
  const directId = (preview: Preview) => preview.code.offer ? 'bark-offer' : 'bark-invoice';

  return {
    source: swap.source,
    name: 'Bark',
    swaps: swap.swaps,
    providerNames: swap.providerNames,

    async quoteOptions(preview, route) {
      if (route.kind === 'direct') {
        const id = directId(preview), name = directName(preview);
        try { return [{ id, name, quote: await directQuote(preview) }]; }
        catch (e) { return [{ id, name, unavailable: e instanceof Error ? e.message : FEE_UNAVAILABLE }]; }
      }
      return swapOptions(preview, route);
    },

    async quote(preview, route) {
      if (route.kind === 'direct') return directQuote(preview);
      const quotes = (await swapOptions(preview, route)).flatMap(o => o.quote ? [o.quote] : []);
      if (!quotes.length) throw new Error('No swap provider gave a complete quote.');
      return quotes.sort((a, b) => a.totalSat! - b.totalSat!)[0];
    },

    async execute(preview, route, quote, attemptId) {
      if (route.kind === 'direct') {
        const saved = directQuotes.get(quote);
        const now = Math.floor(Date.now() / 1000);
        const current = saved?.kind === 'offer' ? preview.code.offer : preview.code.invoice;
        if (!saved || saved.destination !== current || quote.expiresAt <= now) {
          throw new PaymentNotSentError('Review the payment again to get a fresh quote.');
        }
        if (saved.invoiceExpiresAt !== undefined && saved.invoiceExpiresAt <= now) {
          throw new PaymentNotSentError('This Lightning invoice has expired. Ask for a new one.');
        }
        directQuotes.delete(quote);
        const sent = await bark.sendPayment({ invoice: saved.destination, amount: saved.fixedAmount ? undefined : quote.recipientSat });
        // An invoice payment can always be followed by the invoice's own payment hash.
        const result = sent && saved.paymentHash && !sent.paymentHash ? { ...sent, paymentHash: saved.paymentHash } : sent;
        await AsyncStorage.setItem(offerRef(attemptId), JSON.stringify(result));
        return resultOf(result);
      }
      const inner = swapQuotes.get(quote);
      if (!inner) throw new PaymentNotSentError('Review the payment again to get a fresh quote.');
      swapQuotes.delete(quote);
      return swap.execute!(preview, route, inner, attemptId);
    },

    async status(attemptId) {
      const raw = await AsyncStorage.getItem(offerRef(attemptId));
      if (!raw) return swap.status!(attemptId);
      const saved = JSON.parse(raw) as { paymentHash: string; status: string };
      if (saved.status !== 'pending') return resultOf(saved);
      // Bark reported the payment in flight without a hash to follow it by: its outcome
      // can only be read from Bark's activity, so it needs checking rather than staying pending.
      if (!saved.paymentHash) return { status: 'unknown' };
      return resultOf({ paymentHash: saved.paymentHash, status: (await paymentStatus(saved.paymentHash)).status });
    },
  };
}

/** Ark rail id of a Bark server: `bark:<x-only key>` (SSPS §1.1). */
export function barkRail(serverPubkey: string): string | null {
  const key = serverPubkey.trim().toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(key)) return `bark:${key.slice(2)}`;
  return /^[0-9a-f]{64}$/.test(key) ? `bark:${key}` : null;
}

interface ArkSendOptions {
  id: string;
  rail: string;
  name: string;
  /** The receiver's Ark address for this route; throws when it has none Bark can pay. */
  destination(preview: Preview, route: Route): string;
}

/** Pays an Ark address out-of-round from the Bark balance. */
function createBarkArkSendAccount(bark: BarkPaySender, network: Network, opts: ArkSendOptions): PayAccount {
  const quotes = new WeakMap<Quote, string>();
  const ref = (attemptId: string) => `kaleidopay-${opts.id}-${attemptId}`;
  const { id, name } = opts;

  async function quote(preview: Preview, route: Route): Promise<Quote> {
    const address = opts.destination(preview, route);
    let fee: number | null = null;
    try { fee = validFeeSats((await bark.backend?.estimatePaymentFee('ark', preview.request.amountSat))?.feeSats); } catch { /* below */ }
    if (fee === null) throw new Error(FEE_UNAVAILABLE);
    await assertSpendable(bark, preview.request.amountSat + fee);
    const result: Quote = { recipientSat: preview.request.amountSat, feeSat: fee, totalSat: preview.request.amountSat + fee,
      expiresAt: Math.floor(Date.now() / 1000) + QUOTE_TTL_S, estimatedSeconds: 5 };
    quotes.set(result, address);
    return result;
  }

  return {
    source: { id, rail: opts.rail, network },
    name: 'Bark',
    swaps: [],
    quote,
    async quoteOptions(preview, route) {
      try { return [{ id, name, quote: await quote(preview, route) }]; }
      catch (e) { return [{ id, name, unavailable: e instanceof Error ? e.message : FEE_UNAVAILABLE }]; }
    },
    async execute(preview, route, accepted, attemptId) {
      const address = quotes.get(accepted);
      let current: string | undefined;
      try { current = opts.destination(preview, route); } catch { /* refused below */ }
      if (!address || address !== current || accepted.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new PaymentNotSentError('Review the payment again to get a fresh quote.');
      }
      quotes.delete(accepted);
      const sent = await bark.sendPayment({ invoice: address, amount: accepted.recipientSat });
      // An out-of-round Ark payment is final once the server cosigns it, which is when the call returns
      // (the adapter reports it as 'pending' with no hash). Anything else is not shown as paid.
      const result: PaymentResult = sent?.status === 'failed' ? { status: 'failed' }
        : sent && (sent.status === 'pending' || sent.status === 'confirmed' || sent.status === 'completed') && sent.amount === accepted.recipientSat
          ? { status: 'completed' } : { status: 'unknown' };
      await AsyncStorage.setItem(ref(attemptId), JSON.stringify(result));
      return result;
    },
    async status(attemptId) {
      const raw = await AsyncStorage.getItem(ref(attemptId));
      return raw ? JSON.parse(raw) as PaymentResult : { status: 'unknown' };
    },
  };
}

/** Pays the receiver's Bark address straight from the Bark balance, when the offer lists this server. */
export function createBarkArkAccount(bark: BarkPaySender, network: Network, rail: string): PayAccount {
  return createBarkArkSendAccount(bark, network, {
    id: 'bark-ark', rail, name: 'To their Bark address',
    destination(preview, route) {
      const address = preview.addresses?.[route.to];
      if (route.kind !== 'direct' || route.to !== rail || !address) throw new Error('The receiver listed no Bark address on this server.');
      if (bark.backend?.isBarkAddress && !bark.backend.isBarkAddress(address)) throw new Error('This Bark wallet cannot pay that address.');
      return address;
    },
  });
}

/**
 * Pays a plain Ark address (rail `ark`) from the Bark balance. Only an address on Bark's own
 * server can be paid this way, so anything Bark can't confirm as its own is refused.
 */
export function createBarkArkAddressAccount(bark: BarkPaySender, network: Network): PayAccount {
  return createBarkArkSendAccount(bark, network, {
    id: 'bark-ark-address', rail: 'ark', name: 'To their Ark address',
    destination(preview, route) {
      const address = preview.code.arkAddress;
      if (route.kind !== 'direct' || route.to !== `ark:${network}` || !address) throw new Error('The request has no Ark address.');
      if (!bark.backend?.isBarkAddress?.(address)) throw new Error("This Ark address is not on Bark's server.");
      return address;
    },
  });
}

/** Sends to the receiver's bitcoin address from the Bark balance, through Bark's server (SSPS §8.6). */
export function createBarkOnchainAccount(bark: BarkPaySender, network: Network): PayAccount {
  const quotes = new WeakMap<Quote, string>();
  const ref = (attemptId: string) => `kaleidopay-bark-onchain-${attemptId}`;
  const name = 'On-chain send';

  async function quote(preview: Preview, route: Route): Promise<Quote> {
    const address = preview.code.address;
    if (route.kind !== 'direct' || route.to !== `btc:${network}` || !address) throw new Error('The request has no bitcoin address.');
    let fee: number | null = null;
    try { fee = validFeeSats((await bark.backend?.estimatePaymentFee('onchain', preview.request.amountSat, address))?.feeSats); } catch { /* below */ }
    if (fee === null) throw new Error(FEE_UNAVAILABLE);
    await assertSpendable(bark, preview.request.amountSat + fee);
    const result: Quote = { recipientSat: preview.request.amountSat, feeSat: fee, totalSat: preview.request.amountSat + fee,
      expiresAt: Math.floor(Date.now() / 1000) + QUOTE_TTL_S };
    quotes.set(result, address);
    return result;
  }

  return {
    // Network-free rail: planRoutes puts it on this account's network (`btc:<network>`).
    source: { id: 'bark-onchain', rail: 'btc', network },
    name: 'Bark',
    swaps: [],
    quote,
    async quoteOptions(preview, route) {
      try { return [{ id: 'bark-onchain', name, quote: await quote(preview, route) }]; }
      catch (e) { return [{ id: 'bark-onchain', name, unavailable: e instanceof Error ? e.message : FEE_UNAVAILABLE }]; }
    },
    async execute(preview, route, accepted, attemptId) {
      const address = quotes.get(accepted);
      if (!address || address !== preview.code.address || accepted.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new PaymentNotSentError('Review the payment again to get a fresh quote.');
      }
      quotes.delete(accepted);
      const sent = await bark.sendPayment({ invoice: address, amount: accepted.recipientSat });
      // Broadcast is the payment; the txid is the receipt.
      const result: PaymentResult = sent?.paymentHash ? { status: 'completed', reference: sent.paymentHash } : { status: 'unknown' };
      await AsyncStorage.setItem(ref(attemptId), JSON.stringify(result));
      return result;
    },
    async status(attemptId) {
      const raw = await AsyncStorage.getItem(ref(attemptId));
      return raw ? JSON.parse(raw) as PaymentResult : { status: 'unknown' };
    },
  };
}

export function connectBarkToKaleidoPay(bark: BarkPaySender, network: Network): void {
  disconnect?.();
  const current = ++generation;
  const unregister = [
    registerKaleidoPayAccount(createBarkPayAccount(bark, network)),
    registerKaleidoPayAccount(createBarkOnchainAccount(bark, network)),
    registerKaleidoPayAccount(createBarkArkAddressAccount(bark, network)),
  ];
  let ark: Promise<boolean> | null = null;
  // The Ark route needs the server key, which the wallet reports only once it has reached the server.
  const tryArk = async (sync: boolean): Promise<boolean> => {
    if (sync) await bark.backend?.sync?.().catch(() => undefined);
    const info = await bark.getConnectionInfo?.().catch(() => undefined);
    const rail = info?.connected && info.nodeId ? barkRail(info.nodeId) : null;
    if (!rail || current !== generation) return false;
    unregister.push(registerKaleidoPayAccount(createBarkArkAccount(bark, network, rail)));
    return true;
  };
  const ensureArk = (sync: boolean) => {
    ark = ark ?? tryArk(sync).then(ok => { if (!ok) ark = null; return ok; });
    return ark;
  };
  unregister.push(registerKaleidoPayPreparer(async () => { await ensureArk(true); }));
  disconnect = () => { generation++; unregister.forEach(u => u()); };
  void (async () => {
    for (const delay of ARK_INFO_RETRY_MS) {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (current !== generation || await ensureArk(false)) return;
    }
  })();
}

export function disconnectBarkFromKaleidoPay(): void {
  disconnect?.();
  disconnect = null;
}
