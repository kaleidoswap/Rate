import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'light-bolt11-decoder';
import { decodeBolt11 } from '../../utils/decodeInvoice';
import { estimatePaymentFee, type PaymentFeeRequest } from '../paymentReview';
import { registerKaleidoPayAccount } from './index';
import type { AccountQuoteOption, Network, PayAccount, PaymentResult, Preview, Quote, Route, SpendAsset } from './index';
import { PaymentNotSentError } from './errors';

// ---------------------------------------------------------------------------
// Shared by sparkPay / rgbPay: a direct (same-rail) account that quotes
// from the wallet's own fee estimate and balance, pays only an approved quote, and
// keeps the outcome per attempt so it can be followed after the screen closes.
// ---------------------------------------------------------------------------

export const QUOTE_TTL_S = 60;
const now = () => Math.floor(Date.now() / 1000);

/** What a wallet adapter reports for a send or a status lookup, mapped to a payment result. */
export function resultOf(status: unknown, reference?: string): PaymentResult {
  const ref = reference ? { reference } : {};
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  if (['confirmed', 'completed', 'succeeded', 'settled', 'paid'].includes(s)) return { status: 'completed', ...ref };
  if (['failed', 'cancelled', 'canceled', 'expired'].includes(s)) return { status: 'failed', ...ref };
  if (s === 'pending') return { status: 'pending', ...ref };
  return { status: 'unknown', ...ref };
}

/** Amount and expiry (ms) of a BOLT11 invoice; expiry is null when it cannot be read. */
export function invoiceTerms(invoice: string): { amountSat?: number; expiresAtMs: number | null } {
  const amountSat = decodeBolt11(invoice).amountSats || undefined;
  let expiresAtMs: number | null = null;
  try {
    const sections = decode(invoice).sections as { name: string; value?: unknown }[];
    const timestamp = Number(sections.find(s => s.name === 'timestamp')?.value);
    const expiry = sections.find(s => s.name === 'expiry');
    const duration = expiry ? Number(expiry.value) : 3600; // BOLT11 default
    if (Number.isSafeInteger(timestamp) && timestamp > 0 && Number.isSafeInteger(duration) && duration >= 0) expiresAtMs = (timestamp + duration) * 1000;
  } catch { /* unreadable: the wallet will refuse an expired invoice */ }
  return { amountSat, expiresAtMs };
}

/** Lightning invoice checks shared by every account that pays BOLT11 directly. */
export function lightningInvoiceFor(preview: Preview): { invoice: string; amountless: boolean; expiresAt?: number } {
  const invoice = preview.code.invoice;
  if (!invoice) throw new Error('The request has no Lightning invoice.');
  const terms = invoiceTerms(invoice);
  if (terms.amountSat !== undefined && terms.amountSat !== preview.request.amountSat) throw new Error('The invoice asks for a different amount than this payment.');
  if (terms.expiresAtMs !== null && terms.expiresAtMs <= Date.now()) throw new Error('This invoice has expired. Ask the recipient for a new one.');
  return { invoice, amountless: terms.amountSat === undefined, ...(terms.expiresAtMs !== null ? { expiresAt: Math.floor(terms.expiresAtMs / 1000) } : {}) };
}

export function notEnough(walletName: string): Error {
  return new Error(`Not enough balance in ${walletName}`);
}

export interface Prepared<T> {
  /** Sats (or base units) the payment costs on top of the amount; never a placeholder for "unknown". */
  feeSat: number;
  terms: T;
  /** Shown under the option, e.g. that the fee is an estimate or a maximum. */
  detail?: string;
  /** A quote may not outlive what it pays (e.g. an invoice's expiry). */
  expiresAt?: number;
  /** For asset payments: the spend in the asset (the default is sats). */
  spend?: Quote['spend'];
}

export interface DirectAccountConfig<T> {
  id: string;
  /** Base rail, e.g. 'ln'; the account's network is appended for routing. */
  rail: string;
  network: Network;
  /** Wallet name for messages, e.g. 'Spark'. */
  walletName: string;
  /** Option title, e.g. 'Lightning'. */
  optionName: string;
  spendAsset?: SpendAsset;
  estimatedSeconds?: number;
  isConnected: () => boolean;
  /** Validates destination and balance and estimates the fee. Never sends. */
  prepare: (preview: Preview) => Promise<Prepared<T>>;
  /** True while the request still names what was quoted. */
  matches: (preview: Preview, terms: T) => boolean;
  send: (terms: T, quote: Quote) => Promise<PaymentResult>;
  /** Follows a pending payment by its reference. */
  follow?: (reference: string) => Promise<PaymentResult>;
}

export function createDirectAccount<T>(cfg: DirectAccountConfig<T>): PayAccount {
  const railOnNetwork = `${cfg.rail}:${cfg.network}`;
  const approved = new WeakMap<Quote, { terms: T; detail?: string }>();
  const key = (attemptId: string) => `kaleidopay-${cfg.id}-${attemptId}`;

  async function quote(preview: Preview, route: Route): Promise<Quote> {
    if (route.kind !== 'direct' || route.to !== railOnNetwork) throw new Error(`${cfg.walletName} cannot pay this route.`);
    if (!cfg.isConnected()) throw new Error(`${cfg.walletName} is not connected.`);
    const prepared = await cfg.prepare(preview);
    const amount = preview.request.amountSat;
    const expiresAt = Math.min(now() + QUOTE_TTL_S, prepared.expiresAt ?? Infinity);
    const result: Quote = {
      recipientSat: amount, feeSat: prepared.feeSat, totalSat: amount + prepared.feeSat, expiresAt,
      ...(prepared.spend ? { spend: prepared.spend } : {}),
      ...(cfg.estimatedSeconds ? { estimatedSeconds: cfg.estimatedSeconds } : {}),
    };
    approved.set(result, { terms: prepared.terms, detail: prepared.detail });
    return result;
  }

  return {
    source: { id: cfg.id, rail: cfg.rail, network: cfg.network },
    name: cfg.walletName,
    ...(cfg.spendAsset ? { spendAsset: cfg.spendAsset } : {}),
    swaps: [],
    quote,
    async quoteOptions(preview, route): Promise<AccountQuoteOption[]> {
      try {
        const q = await quote(preview, route);
        return [{ id: cfg.id, name: cfg.optionName, quote: q, ...(approved.get(q)?.detail ? { detail: approved.get(q)!.detail } : {}) }];
      } catch (e) {
        return [{ id: cfg.id, name: cfg.optionName, unavailable: e instanceof Error ? e.message : 'Quote unavailable' }];
      }
    },
    async execute(preview, route, accepted, attemptId) {
      const saved = approved.get(accepted);
      if (!saved || route.to !== railOnNetwork || accepted.expiresAt <= now() || !cfg.matches(preview, saved.terms)) {
        throw new PaymentNotSentError('Review the payment again to get a fresh quote.');
      }
      if (!cfg.isConnected()) throw new PaymentNotSentError(`${cfg.walletName} is not connected.`);
      approved.delete(accepted); // a quote pays once
      // Recorded before sending: after a crash the attempt reads as unknown, never as unpaid.
      await AsyncStorage.setItem(key(attemptId), JSON.stringify({ status: 'unknown' }));
      const result = await cfg.send(saved.terms, accepted);
      await AsyncStorage.setItem(key(attemptId), JSON.stringify(result));
      return result;
    },
    async status(attemptId) {
      const raw = await AsyncStorage.getItem(key(attemptId));
      if (!raw) return { status: 'unknown' };
      const saved = JSON.parse(raw) as PaymentResult;
      if (saved.status !== 'pending' || !saved.reference || !cfg.follow || !cfg.isConnected()) return saved;
      const next = await cfg.follow(saved.reference);
      // A failed lookup leaves the payment pending rather than unknown.
      if (next.status === 'unknown') return saved;
      const updated: PaymentResult = { status: next.status, reference: saved.reference };
      if (updated.status !== 'pending') await AsyncStorage.setItem(key(attemptId), JSON.stringify(updated));
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// Spark
// ---------------------------------------------------------------------------

/** The part of MobileSparkAdapter (protocolManager.getAdapter('SPARK')) these accounts use. */
export interface SparkPayAdapter {
  isConnected?(): boolean;
  getBtcBalance(): Promise<{ confirmed: number }>;
  quotePaymentFee?(request: PaymentFeeRequest): Promise<number | null>;
  sendPayment(request: { invoice: string; amount?: number; maxFeeSats?: number }): Promise<{ paymentHash: string; status: string }>;
  getPaymentStatus(id: string): Promise<{ status: string }>;
  /** Existing mainnet on-chain withdrawal account (sparkAccount.ts). */
  createPaymentAccount?(walletId: number): PayAccount | null;
  /** Spark tokens (e.g. USDB) held by the wallet, with their balance in base units. */
  listAssets?(): Promise<Array<{ id: string; ticker: string; name?: string; precision: number; balance?: { available?: number } }>>;
  /** Sends a Spark token to a Spark address. */
  sendAsset?(params: { assetId: string; amount: number; recipientId: string }): Promise<{ txId: string }>;
}

/** Lightning fee used only when Spark returns no quote; it is also passed as the fee cap, so it is a true maximum. */
export function fallbackLightningFee(amountSat: number): number {
  return Math.max(10, Math.ceil(amountSat * 0.01));
}

async function sparkSpendable(spark: SparkPayAdapter): Promise<number> {
  const balance = await spark.getBtcBalance();
  const confirmed = Number(balance?.confirmed);
  if (!Number.isFinite(confirmed)) throw new Error('Could not read your Spark balance. Try again.');
  return Math.max(0, Math.floor(confirmed));
}

const connected = (spark: SparkPayAdapter) => () => spark.isConnected?.() ?? true;
const sparkFollow = (spark: SparkPayAdapter) => async (id: string) => resultOf((await spark.getPaymentStatus(id))?.status, id);

export function createSparkLightningAccount(spark: SparkPayAdapter, network: Network): PayAccount {
  return createDirectAccount<{ invoice: string; amountless: boolean }>({
    id: 'spark-ln', rail: 'ln', network, walletName: 'Spark', optionName: 'Lightning', estimatedSeconds: 10,
    isConnected: connected(spark),
    async prepare(preview) {
      const { invoice, amountless, expiresAt } = lightningInvoiceFor(preview);
      const amount = preview.request.amountSat;
      const [quoted, spendable] = await Promise.all([
        estimatePaymentFee(spark, { method: 'lightning', destination: invoice, amountSats: amount, amountless }).catch(() => null),
        sparkSpendable(spark),
      ]);
      const feeSat = quoted ?? fallbackLightningFee(amount);
      if (amount + feeSat > spendable) throw notEnough('Spark');
      return { feeSat, terms: { invoice, amountless }, expiresAt,
        ...(quoted === null ? { detail: 'Spark could not quote this fee; it is a maximum' } : {}) };
    },
    matches: (preview, terms) => preview.code.invoice === terms.invoice,
    async send(terms, quote) {
      try {
        // The quoted fee is the cap: Spark refuses rather than charge more than was shown.
        const sent = await spark.sendPayment({ invoice: terms.invoice, maxFeeSats: quote.feeSat,
          ...(terms.amountless ? { amount: quote.recipientSat } : {}) });
        return resultOf(sent?.status, sent?.paymentHash || undefined);
      } catch (error) {
        // Settled as failed by Spark: the funds stay in the wallet.
        if ((error as { code?: string })?.code === 'LIGHTNING_PAYMENT_FAILED') return { status: 'failed' };
        throw error;
      }
    },
    follow: sparkFollow(spark),
  });
}

export function createSparkTransferAccount(spark: SparkPayAdapter, network: Network): PayAccount {
  return createDirectAccount<{ address: string }>({
    id: 'spark-spark', rail: 'spark', network, walletName: 'Spark', optionName: 'Spark transfer', estimatedSeconds: 5,
    isConnected: connected(spark),
    async prepare(preview) {
      const address = preview.code.sparkAddress;
      if (!address) throw new Error('The request has no Spark address.');
      const amount = preview.request.amountSat;
      const [quoted, spendable] = await Promise.all([
        estimatePaymentFee(spark, { method: 'spark', destination: address, amountSats: amount }).catch(() => null),
        sparkSpendable(spark),
      ]);
      // Spark-to-Spark transfers carry no fee by protocol; the adapter sends them at zero fee.
      const feeSat = quoted ?? 0;
      if (amount + feeSat > spendable) throw notEnough('Spark');
      return { feeSat, terms: { address } };
    },
    matches: (preview, terms) => preview.code.sparkAddress === terms.address,
    async send(terms, quote) {
      const sent = await spark.sendPayment({ invoice: terms.address, amount: quote.recipientSat });
      return resultOf(sent?.status, sent?.paymentHash || undefined);
    },
    follow: sparkFollow(spark),
  });
}

/** A Spark token the wallet can send, with its spendable balance in base units. */
export interface SparkToken extends SpendAsset { name: string; available: number }

/** The Spark tokens this wallet holds (never BTC), largest balance first. */
export async function sparkTokens(spark: SparkPayAdapter): Promise<SparkToken[]> {
  if (!spark.listAssets) return [];
  const assets = await spark.listAssets();
  return assets
    .filter(a => a.id && a.id !== 'BTC' && Number.isInteger(a.precision) && a.precision >= 0 && a.precision <= 18)
    .map(a => ({ id: a.id, ticker: a.ticker || 'TOKEN', name: a.name || a.ticker || 'Token', precision: a.precision,
      available: Math.max(0, Math.floor(Number(a.balance?.available ?? 0)) || 0) }))
    .filter(a => a.available > 0)
    .sort((a, b) => b.available / 10 ** b.precision - a.available / 10 ** a.precision);
}

/**
 * Sends a Spark token (e.g. USDB) to a Spark address. Token transfers carry no fee.
 * The engine checks a quote against the account's spend asset, so this account is
 * made per payment (see registerSparkTokenPayment), like RGB assets.
 */
export function createSparkTokenAccount(spark: SparkPayAdapter, network: Network, asset: SpendAsset): PayAccount {
  return createDirectAccount<{ address: string; assetId: string; amount: number }>({
    id: 'spark-token', rail: 'spark', network, walletName: 'Spark', optionName: `Spark · ${asset.ticker}`, estimatedSeconds: 5,
    spendAsset: asset,
    isConnected: connected(spark),
    async prepare(preview) {
      const address = preview.code.sparkAddress;
      const requested = preview.request.asset;
      if (!address) throw new Error('Tokens can only be sent to a Spark address.');
      if (!requested || requested.id !== asset.id) throw new Error('This account sends a different token.');
      if (!spark.sendAsset) throw new Error('This Spark wallet cannot send tokens.');
      const held = (await sparkTokens(spark)).find(t => t.id === asset.id);
      if (!held || requested.amount > held.available) throw notEnough('Spark');
      return {
        feeSat: 0,
        spend: { asset, amount: requested.amount, fee: 0, total: requested.amount },
        terms: { address, assetId: requested.id, amount: requested.amount },
      };
    },
    matches: (preview, terms) => preview.code.sparkAddress === terms.address
      && preview.request.asset?.id === terms.assetId && preview.request.asset?.amount === terms.amount,
    async send(terms) {
      const sent = await spark.sendAsset!({ assetId: terms.assetId, amount: terms.amount, recipientId: terms.address });
      // transferTokens returns once the transfer is final on Spark.
      return sent?.txId ? { status: 'completed', reference: sent.txId } : { status: 'unknown' };
    },
  });
}

let currentSpark: { spark: SparkPayAdapter; network: Network } | null = null;
let tokenUnregister: (() => void) | null = null;

/** The connected Spark wallet's tokens, for Send's asset choice. Empty when Spark is not connected. */
export async function connectedSparkTokens(): Promise<SparkToken[]> {
  return currentSpark ? sparkTokens(currentSpark.spark) : [];
}

/** Registers the Spark-token account for one payment's token (replacing any earlier one). */
export function registerSparkTokenPayment(asset: SpendAsset): () => void {
  if (!currentSpark) throw new Error('Spark is not connected.');
  tokenUnregister?.();
  const unregister = registerKaleidoPayAccount(createSparkTokenAccount(currentSpark.spark, currentSpark.network, asset));
  tokenUnregister = unregister;
  return () => { unregister(); if (tokenUnregister === unregister) tokenUnregister = null; };
}

/**
 * Registers Spark's Lightning and Spark-address accounts. With `onchainWalletId` it also
 * registers the existing on-chain withdrawal account (sparkAccount.ts, mainnet only).
 */
export function connectSparkPayAccounts(spark: SparkPayAdapter, network: Network, opts: { onchainWalletId?: number } = {}): () => void {
  const unregister = [
    registerKaleidoPayAccount(createSparkLightningAccount(spark, network)),
    registerKaleidoPayAccount(createSparkTransferAccount(spark, network)),
  ];
  const context = { spark, network };
  currentSpark = context;
  unregister.push(() => { if (currentSpark === context) { currentSpark = null; tokenUnregister?.(); tokenUnregister = null; } });
  if (opts.onchainWalletId !== undefined) {
    let onchain: PayAccount | null = null;
    try { onchain = spark.createPaymentAccount?.(opts.onchainWalletId) ?? null; } catch { /* not connected / not mainnet */ }
    if (onchain) unregister.push(registerKaleidoPayAccount(onchain));
  }
  return () => unregister.forEach(u => u());
}
