/**
 * Move bitcoin between Spark and Arkade, over Lightning, through the KaleidoSwap
 * maker (or another Arkade Intents solver).
 *
 * No new swap machinery: each direction is a Lightning receive on one wallet
 * paid by the other through KaleidoPay, which already quotes, refuses changed
 * terms, persists recovery data before funding and reconciles after a restart.
 *
 * - Spark → Arkade: Arkade asks a provider for a hold invoice
 *   (`createArkadeLightningReceive`, the maker's `BTC@LN/BTC@ARK` reverse
 *   route), Spark pays it, and the wallet claims the provider's Arkade lockup.
 *   An interrupted claim finishes in the Arkade account's recovery pass.
 * - Arkade → Spark: Spark mints a BOLT11 invoice and the Arkade account pays it
 *   through its Arkade Intents swap (the maker's `ARKD → BTC@LN` route). A swap
 *   that does not settle is refunded by the same recovery pass.
 */
import type { ArkadeLightningReceive, ArkadeLightningReceiveOptions } from '../kaleidoPay/arkadeIntents';
import type { ArkadeSwapPhase } from '@kaleidorg/swap-sdk/arkade';
import type { Network, PaymentOffer, PaymentResult, Preview, PreviewOptions } from '../kaleidoPay';

export type LayerSwapDirection = 'spark-to-arkade' | 'arkade-to-spark';

export const LAYER_SWAP_LABEL: Record<LayerSwapDirection, { from: string; to: string }> = {
  'spark-to-arkade': { from: 'Spark', to: 'Arkade' },
  'arkade-to-spark': { from: 'Arkade', to: 'Spark' },
};

/** The KaleidoPay account that pays each direction's invoice. */
const PAYING_SOURCE: Record<LayerSwapDirection, string> = { 'spark-to-arkade': 'spark-ln', 'arkade-to-spark': 'arkade' };

/** Spark Lightning invoices for an Arkade → Spark move live this long. */
const SPARK_INVOICE_EXPIRY_S = 3600;

/** What the wallets and KaleidoPay give this module; injected so it is testable without React Native. */
export interface LayerSwapDeps {
  prepareKaleidoPay(): Promise<void>;
  previewInput(text: string, amountSat: number | undefined, requestId: string, opts?: PreviewOptions): Promise<Preview>;
  quotePaymentOffers(preview: Preview): Promise<PaymentOffer[]>;
  executePaymentOffer(preview: Preview, offer: PaymentOffer, attemptId: string): Promise<PaymentResult>;
  checkPaymentStatus(sourceId: string, attemptId: string): Promise<PaymentResult>;
  arkadeReceiveOptions(): ArkadeLightningReceiveOptions | null;
  createArkadeLightningReceive(opts: ArkadeLightningReceiveOptions, amountSats: number): Promise<ArkadeLightningReceive>;
  claimArkadeLightningReceive(wallet: unknown, arkServerUrl: string, rfqId: string): Promise<ArkadeSwapPhase | undefined>;
  /** The connected Spark wallet and its chain, or null. */
  spark(): { adapter: SparkLightning; network: Network | undefined } | null;
  newId(): string;
}

/** The Spark adapter calls used here (the same ones Receive makes). */
export interface SparkLightning {
  createInvoice(params: { layer: 'BTC_LN'; amount: number; description: string; expirySeconds: number }): Promise<{ invoice: string }>;
  getInvoiceStatus?(params: { invoice: string }): Promise<{ status?: string; state?: string } | null | undefined>;
}

export interface LayerSwapQuote {
  direction: LayerSwapDirection;
  network: Network;
  /** Sats that land in the destination wallet. */
  receiveSat: number;
  /** Sats that leave the source wallet, fees included. */
  spendSat: number;
  feeSat: number;
  provider: string;
  /** Unix seconds. */
  expiresAt: number;
  estimatedSeconds?: number;
  /** Other providers and why they could not quote, for the review screen. */
  unavailable: { provider: string; reason: string }[];
  /** @internal what executing needs. */
  readonly handle: { preview: Preview; offer: PaymentOffer; invoice: string; arkade?: ArkadeLightningReceive; options?: ArkadeLightningReceiveOptions };
}

export type LayerSwapStep = 'paying' | 'settling' | 'claiming';
export type LayerSwapOutcome =
  | { status: 'completed'; reference?: string }
  /** Still in flight: the recovery pass finishes it (claim or refund). Safe to leave. */
  | { status: 'pending'; reference?: string }
  /** Nothing moved, or the swap was refunded. */
  | { status: 'failed'; reason: string };

/** The networks a move can run on: both wallets on the same chain. */
export function layerSwapNetwork(deps: Pick<LayerSwapDeps, 'arkadeReceiveOptions' | 'spark'>): { network: Network } | { unavailable: string } {
  const spark = deps.spark();
  const arkade = deps.arkadeReceiveOptions();
  if (!spark) return { unavailable: 'Connect Spark to move bitcoin between Spark and Arkade.' };
  if (!arkade) return { unavailable: 'Connect Arkade to move bitcoin between Spark and Arkade.' };
  if (!spark.network || spark.network !== arkade.network) {
    return { unavailable: `Spark and Arkade are on different networks (${spark.network ?? 'unknown'} and ${arkade.network}).` };
  }
  return { network: arkade.network };
}

const reasonOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/**
 * Quote a move of `amountSat` (what lands in the destination). For Spark →
 * Arkade this asks a provider for a real hold invoice (an RFQ, as Receive does);
 * nothing is paid until {@link executeLayerSwap}.
 */
export async function quoteLayerSwap(deps: LayerSwapDeps, direction: LayerSwapDirection, amountSat: number): Promise<LayerSwapQuote> {
  if (!Number.isSafeInteger(amountSat) || amountSat <= 0) throw new Error('Enter a whole number of sats.');
  const where = layerSwapNetwork(deps);
  if ('unavailable' in where) throw new Error(where.unavailable);
  const { network } = where;
  await deps.prepareKaleidoPay();

  let invoice: string;
  let payAmount: number;
  let arkade: ArkadeLightningReceive | undefined;
  let options: ArkadeLightningReceiveOptions | undefined;
  if (direction === 'spark-to-arkade') {
    options = deps.arkadeReceiveOptions()!;
    arkade = await deps.createArkadeLightningReceive(options, amountSat);
    if (arkade.amountSats !== amountSat) throw new Error('The provider offered to deliver a different amount.');
    invoice = arkade.invoice;
    payAmount = arkade.payAmountSats;
  } else {
    const spark = deps.spark()!;
    const created = await spark.adapter.createInvoice({ layer: 'BTC_LN', amount: amountSat, description: 'Move from Arkade', expirySeconds: SPARK_INVOICE_EXPIRY_S });
    invoice = created?.invoice;
    if (!invoice) throw new Error('Spark did not create a Lightning invoice.');
    payAmount = amountSat;
  }

  const preview = await deps.previewInput(invoice, payAmount, `layer-${deps.newId()}`, { networks: [network] });
  if (preview.request.amountSat !== payAmount) throw new Error('The invoice asks for a different amount.');
  const offers = (await deps.quotePaymentOffers(preview)).filter(o => o.route.sourceId === PAYING_SOURCE[direction]);
  const unavailable = offers.filter(o => !o.quote || o.unavailable).map(o => ({ provider: o.provider, reason: o.unavailable ?? 'Quote unavailable' }));
  const usable = offers.filter(o => o.quote && !o.unavailable && o.executable && o.quote.expiresAt * 1000 > Date.now());
  const offer = usable.sort((a, b) => a.quote!.totalSat! - b.quote!.totalSat!)[0];
  if (!offer) {
    const from = LAYER_SWAP_LABEL[direction].from;
    throw new Error(unavailable[0]?.reason ?? `${from} cannot pay this move right now.`);
  }
  const quote = offer.quote!;
  const spendSat = quote.totalSat!;
  const expiresAt = Math.min(quote.expiresAt, arkade ? arkade.expiresAt : quote.expiresAt);
  return {
    direction, network, receiveSat: amountSat, spendSat, feeSat: spendSat - amountSat,
    provider: direction === 'spark-to-arkade' ? arkade!.provider : offer.provider,
    expiresAt, estimatedSeconds: quote.estimatedSeconds,
    unavailable: direction === 'arkade-to-spark' ? unavailable : [],
    handle: { preview, offer, invoice, arkade, options },
  };
}

export interface LayerSwapRunOptions {
  onStep?: (step: LayerSwapStep) => void;
  /** Delay between status reads, ms. */
  intervalMs?: number;
  /** Give up waiting (the recovery pass carries on) after this long, ms. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
  const onAbort = () => { clearTimeout(timer); reject(signal!.reason ?? new Error('aborted')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

const paid = (s: unknown) => typeof s === 'string' && ['paid', 'settled', 'completed', 'confirmed', 'succeeded'].includes(s.toLowerCase());

/**
 * Pay an approved quote and follow it until the bitcoin lands. Throws only when
 * nothing was sent (KaleidoPay's PaymentNotSentError); afterwards it reports.
 */
export async function executeLayerSwap(
  deps: LayerSwapDeps,
  quote: LayerSwapQuote,
  { onStep, intervalMs = 4_000, timeoutMs = 5 * 60_000, signal }: LayerSwapRunOptions = {},
): Promise<LayerSwapOutcome> {
  if (quote.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('The quote expired. Get a new one.');
  const { preview, offer, invoice, arkade, options } = quote.handle;
  const attemptId = `layer-${deps.newId()}`;
  onStep?.('paying');
  const result = await deps.executePaymentOffer(preview, offer, attemptId);
  if (result.status === 'failed') return { status: 'failed', reason: result.detail ?? 'The payment failed. No funds left your wallet.' };

  onStep?.(quote.direction === 'spark-to-arkade' ? 'claiming' : 'settling');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (quote.direction === 'spark-to-arkade') {
      const phase = await deps.claimArkadeLightningReceive(options!.wallet, options!.arkServerUrl, arkade!.rfqId).catch(() => undefined);
      if (phase === 'settled') return { status: 'completed', reference: arkade!.rfqId };
      if (phase === 'cancelled' || phase === 'refunded' || phase === 'failed') {
        return { status: 'failed', reason: 'The provider did not deliver on Arkade. A Lightning payment that was not claimed returns to Spark.' };
      }
    } else {
      const spark = deps.spark();
      const status = await spark?.adapter.getInvoiceStatus?.({ invoice }).catch(() => null);
      if (paid(status?.status ?? status?.state)) return { status: 'completed', reference: result.reference };
      const payment = await deps.checkPaymentStatus(PAYING_SOURCE[quote.direction], attemptId);
      if (payment.status === 'completed') return { status: 'completed', reference: payment.reference ?? result.reference };
      if (payment.status === 'failed') return { status: 'failed', reason: 'The swap did not complete. Your Arkade funds are refunded.' };
    }
    if (Date.now() >= deadline) return { status: 'pending', reference: arkade?.rfqId ?? result.reference };
    await sleep(intervalMs, signal);
  }
}

/** The app's wallets and KaleidoPay, loaded on first use. */
export function defaultLayerSwapDeps(): LayerSwapDeps {
  const pay = require('../kaleidoPay') as typeof import('../kaleidoPay');
  const connect = require('../kaleidoPay/connect') as typeof import('../kaleidoPay/connect');
  const intents = require('../kaleidoPay/arkadeIntents') as typeof import('../kaleidoPay/arkadeIntents');
  return {
    prepareKaleidoPay: () => pay.prepareKaleidoPay(),
    previewInput: pay.previewInput,
    quotePaymentOffers: (preview) => pay.quotePaymentOffers(preview),
    executePaymentOffer: pay.executePaymentOffer,
    checkPaymentStatus: pay.checkPaymentStatus,
    arkadeReceiveOptions: connect.arkadeReceiveOptions,
    createArkadeLightningReceive: intents.createArkadeLightningReceive,
    claimArkadeLightningReceive: (wallet, url, rfqId) => intents.claimArkadeLightningReceive(wallet, url, rfqId),
    spark: connect.connectedSparkWallet,
    newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  };
}
