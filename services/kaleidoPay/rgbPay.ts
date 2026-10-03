import { routeSpendable } from '../../utils/payment-balance';
import { registerKaleidoPayAccount } from './index';
import type { Network, PayAccount, RequestAsset, SpendAsset } from './index';
import { createDirectAccount, lightningInvoiceFor, notEnough, resultOf } from './sparkPay';

/** The part of the RGB node adapter (protocolManager 'RGB_LN', NwcRgbAdapter by default) these accounts use. */
export interface RgbPayAdapter {
  isConnected(): boolean;
  /** NwcRgbAdapter: 'rln' for an RGB Lightning node, 'ln' for a plain Lightning wallet. */
  walletType?(): 'ln' | 'rln';
  getBtcBalance(): Promise<{ confirmed: number }>;
  listChannels?(): Promise<any[]>;
  sendPayment(request: { invoice: string; amount?: number }): Promise<{ paymentHash: string; status: string; preimage?: string }>;
  getPaymentStatus(hash: string): Promise<{ status: string }>;
  sendBtcOnchain?(params: { address: string; amount: number; feeRate?: number }): Promise<any>;
  decodeRgbInvoice?(params: { invoice: string }): Promise<any>;
  sendAsset?(params: { asset_id: string; recipientId: string; amount: number }): Promise<any>;
  getAssetBalance?(assetId: string): Promise<any>;
  getAsset?(assetId: string): Promise<{ id: string; ticker: string; precision: number }>;
  getTransaction?(txId: string): Promise<{ status?: string }>;
}

export interface RgbPayOptions {
  /** On-chain fee rate in sat/vB; defaults to the old Send screen's "Normal" (2). */
  feeRate?: () => number;
}

/** Conservative size of a node on-chain send (several inputs, change, RGB anchor); the node picks real inputs. */
export const RGB_ONCHAIN_VBYTES = 300;
const DEFAULT_FEE_RATE = 2;
/** The node cannot quote a Lightning route fee over NWC: an honest upper estimate, marked as such. */
export function rgbLightningFeeEstimate(amountSat: number): number {
  return Math.max(10, Math.ceil(amountSat * 0.01));
}
const ESTIMATE = 'Estimated fee: the node does not quote fees in advance';

function feeRateOf(opts: RgbPayOptions): number {
  const rate = opts.feeRate?.();
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_FEE_RATE;
}
const onchainFee = (opts: RgbPayOptions) => Math.ceil(feeRateOf(opts) * RGB_ONCHAIN_VBYTES);
const isRln = (rgb: RgbPayAdapter) => rgb.walletType?.() !== 'ln';
const txidOf = (r: any): string | undefined => typeof r === 'string' ? r : r?.txid || r?.paymentHash || undefined;
const followTx = (rgb: RgbPayAdapter) => async (txid: string) =>
  rgb.getTransaction ? resultOf((await rgb.getTransaction(txid).catch(() => undefined))?.status, txid) : { status: 'pending' as const, reference: txid };

async function confirmedBtc(rgb: RgbPayAdapter): Promise<{ confirmed: number; total: number }> {
  const balance = await rgb.getBtcBalance();
  const confirmed = Number(balance?.confirmed);
  if (!Number.isFinite(confirmed)) throw new Error('Could not read your RGB node balance. Try again.');
  return { confirmed, total: confirmed };
}

/** Same rule as the old Send screen: an NWC wallet reports its Lightning balance; a raw node, channel outbound capacity. */
async function lightningSpendable(rgb: RgbPayAdapter): Promise<number> {
  const lightningBalance = typeof rgb.walletType === 'function';
  const channels = !lightningBalance && rgb.listChannels ? await rgb.listChannels() : [];
  return routeSpendable(lightningBalance ? await confirmedBtc(rgb) : undefined, 'RGB', 'lightning', channels, lightningBalance);
}

export function createRgbLightningAccount(rgb: RgbPayAdapter, network: Network): PayAccount {
  return createDirectAccount<{ invoice: string; amountless: boolean }>({
    id: 'rgb-ln', rail: 'ln', network, walletName: 'RGB node', optionName: 'Lightning', estimatedSeconds: 10,
    isConnected: () => rgb.isConnected(),
    async prepare(preview) {
      const { invoice, amountless, expiresAt } = lightningInvoiceFor(preview);
      const amount = preview.request.amountSat;
      const feeSat = rgbLightningFeeEstimate(amount);
      if (amount + feeSat > await lightningSpendable(rgb)) throw notEnough('RGB node');
      return { feeSat, terms: { invoice, amountless }, expiresAt, detail: ESTIMATE };
    },
    matches: (preview, terms) => preview.code.invoice === terms.invoice,
    async send(terms, quote) {
      const sent = await rgb.sendPayment(terms.amountless ? { invoice: terms.invoice, amount: quote.recipientSat } : { invoice: terms.invoice });
      // NWC returns 'confirmed' with a preimage and no hash.
      return resultOf(sent?.status, sent?.paymentHash || sent?.preimage || undefined);
    },
    follow: async hash => resultOf((await rgb.getPaymentStatus(hash))?.status, hash),
  });
}

export function createRgbOnchainAccount(rgb: RgbPayAdapter, network: Network, opts: RgbPayOptions = {}): PayAccount {
  return createDirectAccount<{ address: string; feeRate: number }>({
    id: 'rgb-btc', rail: 'btc', network, walletName: 'RGB node', optionName: 'On-chain', estimatedSeconds: 3600,
    isConnected: () => rgb.isConnected(),
    async prepare(preview) {
      const address = preview.code.address;
      if (!address) throw new Error('The request has no bitcoin address.');
      if (!rgb.sendBtcOnchain || !isRln(rgb)) throw new Error('This RGB wallet cannot send on-chain.');
      const amount = preview.request.amountSat;
      const feeRate = feeRateOf(opts);
      const feeSat = onchainFee(opts);
      if (amount + feeSat > Math.floor((await confirmedBtc(rgb)).confirmed)) throw notEnough('RGB node');
      return { feeSat, terms: { address, feeRate }, detail: `${ESTIMATE} (${feeRate} sat/vB)` };
    },
    matches: (preview, terms) => preview.code.address === terms.address,
    async send(terms, quote) {
      const sent = await rgb.sendBtcOnchain!({ address: terms.address, amount: quote.recipientSat, feeRate: terms.feeRate });
      const txid = txidOf(sent);
      return txid ? { status: 'pending', reference: txid } : { status: 'unknown' };
    },
    follow: followTx(rgb),
  });
}

/**
 * Pays an RGB invoice in the asset it asks for. The engine checks a quote against the account's
 * spend asset, so this account is made per payment (see registerRgbAssetPayment).
 */
export function createRgbAssetAccount(rgb: RgbPayAdapter, network: Network, asset: SpendAsset, opts: RgbPayOptions = {}): PayAccount {
  return createDirectAccount<{ invoice: string; assetId: string; amount: number }>({
    id: 'rgb-asset', rail: 'rgb', network, walletName: 'RGB node', optionName: `RGB · ${asset.ticker}`, estimatedSeconds: 3600,
    spendAsset: asset,
    isConnected: () => rgb.isConnected(),
    async prepare(preview) {
      const invoice = preview.code.rgbInvoice;
      const requested = preview.request.asset;
      if (!invoice || !requested) throw new Error('The request has no RGB invoice.');
      if (requested.id !== asset.id) throw new Error('This account pays a different asset.');
      if (!rgb.sendAsset || !rgb.decodeRgbInvoice || !isRln(rgb)) throw new Error('This wallet cannot send RGB assets.');
      const decoded = await rgb.decodeRgbInvoice({ invoice });
      if (decoded?.asset_id && decoded.asset_id !== requested.id) throw new Error('The invoice asks for a different asset.');
      const invoiceAmount = fungibleAmount(decoded);
      if (invoiceAmount !== undefined && invoiceAmount !== requested.amount) throw new Error('The invoice asks for a different amount.');
      if (rgb.getAssetBalance) {
        const balance = await rgb.getAssetBalance(requested.id);
        // On-chain spendable: the node's available balance less what sits in channels.
        const onchain = Number(balance?.available ?? 0) - Number(balance?.offchain_outbound ?? 0);
        if (!Number.isFinite(onchain) || requested.amount > onchain) throw notEnough('RGB node');
      }
      const btcFee = onchainFee(opts);
      return {
        // The miner fee is paid in sats from the node's bitcoin, not from the asset.
        feeSat: btcFee,
        spend: { asset, amount: requested.amount, fee: 0, total: requested.amount },
        terms: { invoice, assetId: requested.id, amount: requested.amount },
        detail: `Plus about ${btcFee.toLocaleString()} sats network fee (estimate)`,
      };
    },
    matches: (preview, terms) => preview.code.rgbInvoice === terms.invoice && preview.request.asset?.id === terms.assetId && preview.request.asset?.amount === terms.amount,
    async send(terms) {
      const sent = await rgb.sendAsset!({ asset_id: terms.assetId, recipientId: terms.invoice, amount: terms.amount });
      const txid = txidOf(sent);
      return txid ? { status: 'pending', reference: txid } : { status: 'unknown' };
    },
    follow: followTx(rgb),
  });
}

function fungibleAmount(decoded: any): number | undefined {
  const a = decoded?.assignment;
  if (a?.type !== 'Fungible' || a.value === undefined || a.value === null || a.value === '') return undefined;
  const n = Number(a.value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * Decodes an RGB invoice into the request's asset (for previewTarget's `opts.asset`).
 * `amount` (base units) is used when the invoice names none.
 */
export async function rgbRequestAsset(rgb: RgbPayAdapter, invoice: string, amount?: number): Promise<RequestAsset> {
  if (!rgb.isConnected()) throw new Error('RGB node not connected. Please connect it in Settings.');
  if (!rgb.decodeRgbInvoice) throw new Error('This wallet cannot read RGB invoices.');
  const decoded = await rgb.decodeRgbInvoice({ invoice });
  const id = decoded?.asset_id;
  if (typeof id !== 'string' || !id) throw new Error('The RGB invoice does not name an asset.');
  const info = rgb.getAsset ? await rgb.getAsset(id).catch(() => undefined) : undefined;
  const precision = Number(info?.precision ?? 0);
  return { id, ticker: info?.ticker ?? 'RGB', precision: Number.isInteger(precision) && precision >= 0 ? precision : 0,
    amount: fungibleAmount(decoded) ?? amount ?? 0 };
}

let current: { rgb: RgbPayAdapter; network: Network; opts: RgbPayOptions } | null = null;
let assetUnregister: (() => void) | null = null;

/**
 * Registers the RGB-asset account for one payment's asset (replacing any earlier one).
 * Call before previewTarget for an RGB invoice; returns the unregister function.
 */
export function registerRgbAssetPayment(asset: SpendAsset): () => void {
  if (!current) throw new Error('RGB node not connected. Please connect it in Settings.');
  assetUnregister?.();
  const unregister = registerKaleidoPayAccount(createRgbAssetAccount(current.rgb, current.network, asset, current.opts));
  assetUnregister = unregister;
  return () => { unregister(); if (assetUnregister === unregister) assetUnregister = null; };
}

/** Registers the RGB node's Lightning account and, on an RGB Lightning node, its on-chain account. */
export function connectRgbPayAccounts(rgb: RgbPayAdapter, network: Network, opts: RgbPayOptions = {}): () => void {
  const unregister = [registerKaleidoPayAccount(createRgbLightningAccount(rgb, network))];
  if (isRln(rgb) && rgb.sendBtcOnchain) unregister.push(registerKaleidoPayAccount(createRgbOnchainAccount(rgb, network, opts)));
  const context = { rgb, network, opts };
  if (isRln(rgb)) current = context;
  return () => {
    unregister.forEach(u => u());
    if (current === context) { current = null; assetUnregister?.(); assetUnregister = null; }
  };
}
