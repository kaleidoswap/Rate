/**
 * Send from Spark to another chain through Flashnet Orchestra: quote, pay the
 * quote's Spark deposit address from this wallet (USDB as a token transfer, BTC
 * as a Spark transfer), submit the order and follow it.
 *
 * The session (utils/crosschain-send.ts) is saved before funds move and after
 * every step, so a crash or a closed app resumes the submit or the tracking and
 * never pays a second time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createQuote,
  getStatus,
  submitOrder,
  type OrchestraEstimate,
  type OrchestraQuote,
} from './orchestra/client';
import { connectedSparkWallet } from './kaleidoPay/connect';
import { sparkTokens, type SparkToken } from './kaleidoPay/sparkPay';
import { isUsdbTokenAddress } from '../utils/flashnet';
import {
  beginPaying,
  canStartTransfer,
  depositAmountRaw,
  markPaid,
  markSubmitted,
  applyOrderStatus,
  orchestraParams,
  parseSession,
  pickSparkTxHash,
  quoteWorseThanReviewed,
  resumeAction,
  toSparkAmount,
  withError,
  type CrossChainForm,
  type CrossChainSendSession,
} from '../utils/crosschain-send';

const key = (walletId: number) => `crosschain-send-v1-${walletId}`;

export async function loadCrossChainSession(walletId: number): Promise<CrossChainSendSession | null> {
  return parseSession(await AsyncStorage.getItem(key(walletId)));
}

export const saveCrossChainSession = (walletId: number, s: CrossChainSendSession) =>
  AsyncStorage.setItem(key(walletId), JSON.stringify(s));

export const clearCrossChainSession = (walletId: number) => AsyncStorage.removeItem(key(walletId));

/** Thrown before anything was paid. */
export class CrossChainNotSentError extends Error {}

/** The quote came back worse than what was reviewed; nothing was paid. */
export class QuoteChangedError extends CrossChainNotSentError {
  constructor(readonly quote: OrchestraQuote) {
    super('The price changed. Review the new amount before sending.');
  }
}

interface SparkSendAdapter {
  getReceiveAddress(kind: 'SPARK'): Promise<{ address: string } | string>;
  getBtcBalance(): Promise<{ confirmed: number }>;
  sendPayment(request: { invoice: string; amount?: number }): Promise<unknown>;
  sendAsset?(params: { assetId: string; amount: number; recipientId: string }): Promise<unknown>;
  listAssets?(): Promise<Array<{ id: string; ticker: string; name?: string; precision: number; balance?: { available?: number } }>>;
}

export interface SparkSource {
  connected: boolean;
  mainnet: boolean;
  btcSat: number;
  usdb: SparkToken | null;
}

function spark(): { adapter: SparkSendAdapter; mainnet: boolean } | null {
  const w = connectedSparkWallet();
  return w ? { adapter: w.adapter as SparkSendAdapter, mainnet: w.network === 'mainnet' } : null;
}

async function usdbToken(adapter: SparkSendAdapter): Promise<SparkToken | null> {
  const tokens = await sparkTokens(adapter as any).catch(() => [] as SparkToken[]);
  return tokens.find(t => isUsdbTokenAddress(t.id)) ?? tokens.find(t => t.ticker.toUpperCase() === 'USDB') ?? null;
}

/** What Spark can spend right now (BTC confirmed, USDB available). */
export async function readSparkSource(): Promise<SparkSource> {
  const s = spark();
  if (!s) return { connected: false, mainnet: false, btcSat: 0, usdb: null };
  const [btc, usdb] = await Promise.all([
    s.adapter.getBtcBalance().then(b => Math.max(0, Math.floor(Number(b?.confirmed) || 0))).catch(() => 0),
    usdbToken(s.adapter),
  ]);
  return { connected: true, mainnet: s.mainnet, btcSat: btc, usdb };
}

const starting = new Set<number>();

export interface SendProgress {
  stage: 'quoting' | 'paying' | 'submitting';
  session?: CrossChainSendSession;
}

/**
 * The one action behind "slide to send": quote → pay from Spark → submit. Throws
 * CrossChainNotSentError when nothing moved. Once the paying record is saved, a
 * failure comes back as a session carrying `lastError` instead of a throw.
 */
export async function sendCrossChain(args: {
  walletId: number;
  form: CrossChainForm;
  reviewed: Pick<OrchestraEstimate, 'estimatedOut' | 'requiredAmountIn'>;
  destDecimals: number;
  id: string;
  onProgress?: (p: SendProgress) => void;
}): Promise<CrossChainSendSession> {
  const { walletId, form } = args;
  if (starting.has(walletId)) throw new CrossChainNotSentError('Another transfer is starting.');
  starting.add(walletId);
  try {
    let existing: CrossChainSendSession | null;
    try { existing = await loadCrossChainSession(walletId); }
    catch { throw new CrossChainNotSentError('Could not read your previous transfer. Check your Spark activity first.'); }
    if (!canStartTransfer(existing)) throw new CrossChainNotSentError('Finish your previous transfer before starting another.');

    const s = spark();
    if (!s) throw new CrossChainNotSentError('Connect your Spark wallet to send to other chains.');
    if (!s.mainnet) throw new CrossChainNotSentError('Sending to other chains works on mainnet only.');

    args.onProgress?.({ stage: 'quoting' });
    const addr = await s.adapter.getReceiveAddress('SPARK');
    const sourceSparkAddress = typeof addr === 'string' ? addr : addr?.address;
    let quote: OrchestraQuote;
    try {
      quote = await createQuote({ ...orchestraParams(form), recipientAddress: form.recipient });
    } catch (e) {
      throw new CrossChainNotSentError(e instanceof Error ? e.message : 'Could not get a quote.');
    }
    if (quoteWorseThanReviewed(args.reviewed, quote, form.mode)) throw new QuoteChangedError(quote);
    const amountRaw = depositAmountRaw(quote, form);
    const amount = toSparkAmount(amountRaw);

    // Re-read the balance right before paying: the quote can ask for more than was shown.
    let token: SparkToken | null = null;
    if (form.source === 'USDB') {
      token = await usdbToken(s.adapter);
      if (!token || !s.adapter.sendAsset) throw new CrossChainNotSentError('No USDB on Spark to send.');
      if (amount > token.available) throw new CrossChainNotSentError('Not enough USDB on Spark for this quote.');
    } else {
      const btc = Math.floor(Number((await s.adapter.getBtcBalance())?.confirmed) || 0);
      if (amount > btc) throw new CrossChainNotSentError('Not enough bitcoin on Spark for this quote.');
    }

    let session = beginPaying({
      id: args.id, form, quote, sourceSparkAddress: sourceSparkAddress ?? '', sourceAmountRaw: amountRaw,
      destDecimals: args.destDecimals, now: Date.now(),
    });
    try { await saveCrossChainSession(walletId, session); }
    catch { throw new CrossChainNotSentError('Could not save the transfer record, so nothing was sent. Try again.'); }
    args.onProgress?.({ stage: 'paying', session });

    let sent: unknown;
    try {
      sent = token
        ? await s.adapter.sendAsset!({ assetId: token.id, amount, recipientId: quote.depositAddress })
        : await s.adapter.sendPayment({ invoice: quote.depositAddress, amount });
    } catch (e) {
      // It may or may not have left the wallet: keep the paying record, which forces a check.
      session = withError(session, e instanceof Error ? e.message : 'The Spark payment did not confirm.', Date.now());
      await saveCrossChainSession(walletId, session).catch(() => {});
      return session;
    }

    session = markPaid(session, pickSparkTxHash(sent), Date.now());
    await saveCrossChainSession(walletId, session).catch(() => {});
    args.onProgress?.({ stage: 'submitting', session });
    return await submitPaid(walletId, session);
  } finally {
    starting.delete(walletId);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Submits a paid (or possibly paid) transfer. Moves no funds, so it is safe to
 * repeat. A "paying" session is submitted by quote alone: Orchestra only accepts
 * it once the deposit has arrived, which is how it is confirmed as paid.
 */
export async function submitPaid(walletId: number, session: CrossChainSendSession, attempts = 3): Promise<CrossChainSendSession> {
  const action = resumeAction(session);
  if (action !== 'submit' && action !== 'verify') return session;
  let lastError = '';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2000 * i);
    try {
      const submitted = await submitOrder({
        quoteId: session.quoteId,
        ...(session.sparkTxHash ? { sparkTxHash: session.sparkTxHash } : {}),
        sourceSparkAddress: session.sourceSparkAddress,
      });
      const next = markSubmitted(session, submitted, Date.now());
      await saveCrossChainSession(walletId, next).catch(() => {});
      return next;
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'The order could not be submitted.';
    }
  }
  const failed = withError(session, lastError, Date.now());
  await saveCrossChainSession(walletId, failed).catch(() => {});
  return failed;
}

/** One status poll of a submitted order. */
export async function refreshOrder(walletId: number, session: CrossChainSendSession): Promise<CrossChainSendSession> {
  if (resumeAction(session) !== 'track' || !session.order) return session;
  const order = await getStatus({ id: session.order.id, readToken: session.order.readToken });
  const next = applyOrderStatus(session, order, Date.now());
  await saveCrossChainSession(walletId, next).catch(() => {});
  return next;
}
