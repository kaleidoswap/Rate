import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { libNetwork, type RgbLibRnAccount } from '../protocols/rgbLibRn';
import type DatabaseService from '../DatabaseService';

export const PHONE_RELAY = 'wss://relay.kaleidoswap.com';
export const PHONE_METHODS = ['get_info', 'kaleido_pay_rgb_invoice', 'kaleido_rgb_payment_status'];
export const nowSeconds = () => Math.floor(Date.now() / 1000);
const hexId = /^[0-9a-f]{32}$/;
export class PhoneWalletError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function checkExpiry(expires: number, now = nowSeconds()) {
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + 300) {
    throw new PhoneWalletError('EXPIRED', 'Request expired or invalid. Create a new request.');
  }
}

export function parsePhoneInvitation(raw: string, now = nowSeconds()) {
  const prefix = 'kaleidoswap://pair?';
  if (!raw.startsWith(prefix) || raw.length > 512)
    throw new Error('Scan a KaleidoSwap browser pairing code.');
  const q = new URLSearchParams(raw.slice(prefix.length));
  const fields = ['version', 'client', 'nonce', 'relay', 'expires'];
  const client = q.get('client') ?? '';
  const nonce = q.get('nonce') ?? '';
  const expires = Number(q.get('expires'));
  if (
    fields.some((k) => q.getAll(k).length !== 1) ||
    [...q.keys()].some((k) => !fields.includes(k)) ||
    q.get('version') !== '1' ||
    q.get('relay') !== PHONE_RELAY ||
    !/^[0-9a-f]{64}$/.test(client) ||
    !hexId.test(nonce)
  )
    throw new Error('Invalid browser pairing code.');
  checkExpiry(expires, now);
  return { client, nonce, expires };
}

export function paymentId(value: unknown): string {
  if (typeof value !== 'string' || !hexId.test(value))
    throw new PhoneWalletError('INVALID_PARAMS', 'Invalid payment ID.');
  return value;
}

type Account = Pick<RgbLibRnAccount, 'network' | 'decodeRgbInvoice' | 'listAssets' | 'transfer'>;
type Ledger = Pick<
  DatabaseService,
  'claimBrowserPayment' | 'beginBrowserSubmission' | 'finishBrowserPayment' | 'browserPayment'
>;
type Params = { invoice?: unknown; payment_id?: unknown; expires_at?: unknown; origin?: unknown };
export type PaymentReview = Readonly<{
  origin?: string;
  client: string;
  wallet: string;
  request: string;
  paymentId: string;
  invoice: string;
  network: string;
  asset: string;
  ticker: string;
  precision: number;
  amount: number;
  recipient: string;
  feeRate: number;
  witnessSats: number;
  expires: number;
}>;

export async function payPhoneInvoice(
  params: Params,
  event: { id: string; expiry: number },
  deps: {
    account: Account;
    walletId: number;
    wallet: string;
    client: string;
    ledger: Ledger;
    guard: () => void;
    approve: (review: PaymentReview) => Promise<void>;
  },
) {
  const { account, ledger, client, walletId } = deps;
  const id = paymentId(params.payment_id);
  const invoice = params.invoice;
  if (
    typeof invoice !== 'string' ||
    invoice.length > 8192 ||
    !invoice ||
    !Number.isSafeInteger(params.expires_at) ||
    params.expires_at !== event.expiry ||
    Object.keys(params).some((k) => !['invoice', 'payment_id', 'expires_at', 'origin'].includes(k))
  ) {
    throw new PhoneWalletError(
      'INVALID_PARAMS',
      'A fixed-amount RGB invoice, payment ID and expiry are required.',
    );
  }
  const origin = params.origin;
  if (origin !== undefined) {
    try {
      if (
        typeof origin !== 'string' ||
        origin.length > 300 ||
        !/^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::[0-9]{1,5})?$/.test(origin) ||
        new URL(origin).origin !== origin
      )
        throw new Error();
    } catch {
      throw new PhoneWalletError('INVALID_PARAMS', 'Invalid requesting site.');
    }
  }
  const invoiceHash = bytesToHex(sha256(utf8ToBytes(JSON.stringify([invoice, origin ?? null]))));
  checkExpiry(event.expiry);
  deps.guard();
  const decoded = await account.decodeRgbInvoice(invoice).catch(() => {
    throw new PhoneWalletError('INVALID_PARAMS', 'This RGB invoice cannot be paid on this phone.');
  });
  const amount = decoded.assignment.type === 'Fungible' ? decoded.assignment.value : undefined;
  if (
    !decoded.asset_id ||
    !decoded.recipient_id ||
    !Number.isSafeInteger(amount) ||
    !amount ||
    amount <= 0 ||
    decoded.network !== libNetwork(account.network)
  )
    throw new PhoneWalletError(
      'INVALID_PARAMS',
      'An invoice with a matching network, asset and positive fungible amount is required.',
    );
  const expiry = Math.min(event.expiry, decoded.expiration_timestamp ?? event.expiry);
  const recipientHash = bytesToHex(
    sha256(utf8ToBytes(JSON.stringify([account.network, decoded.recipient_id]))),
  );
  const prior = await ledger.browserPayment(walletId, client, id);
  if (prior) {
    if (prior.invoice_hash !== invoiceHash)
      throw new PhoneWalletError('INVALID_PARAMS', 'Payment ID has already been used.');
    if (prior.state === 'succeeded' && prior.txid) return { txid: prior.txid };
    if (prior.state === 'failed') throw new PhoneWalletError('RESTRICTED', 'Payment was not approved.');
    throw new PhoneWalletError('OTHER', 'Payment already requested. Check its status.');
  }
  const assets = await account.listAssets();
  const asset = assets.nia?.find((a) => a.assetId === decoded.asset_id);
  if (
    !asset ||
    assets.uda?.some((a) => a.assetId === decoded.asset_id) ||
    !Number.isInteger(asset.precision) ||
    asset.precision < 0 ||
    asset.precision > 18 ||
    !Number.isSafeInteger(asset.balance?.spendable) ||
    asset.balance.spendable < amount
  )
    throw new PhoneWalletError('RESTRICTED', 'This fungible asset or amount is unavailable.');
  const review: PaymentReview = Object.freeze({
    ...(typeof origin === 'string' ? { origin } : {}),
    client,
    wallet: deps.wallet,
    request: event.id,
    paymentId: id,
    invoice,
    network: account.network,
    asset: asset.assetId,
    ticker: asset.ticker,
    precision: asset.precision,
    amount,
    recipient: decoded.recipient_id,
    feeRate: 2,
    witnessSats: /(^|:)wvout:/i.test(decoded.recipient_id) ? 1000 : 0,
    expires: expiry,
  });
  function guard() {
    deps.guard();
    checkExpiry(expiry);
  }
  guard();
  if (!(await ledger.claimBrowserPayment(walletId, client, id, recipientHash, invoiceHash))) {
    throw new PhoneWalletError(
      'OTHER',
      'This payment ID or recipient was already requested. Check payment history.',
    );
  }
  let handedToNative = false;
  try {
    guard();
    await deps.approve(review);
    guard();
    await ledger.beginBrowserSubmission(walletId, client, id);
    guard();
    const result = await account.transfer(
      {
        token: review.asset,
        recipient: invoice,
        amount,
        feeRate: review.feeRate,
        minConfirmations: 1,
        ...(review.witnessSats ? { witnessData: { amountSat: review.witnessSats } } : {}),
      },
      () => {
        guard();
        handedToNative = true;
      },
    );
    if (typeof result.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(result.txid))
      throw new Error('Missing transaction ID.');
    await ledger.finishBrowserPayment(walletId, client, id, 'succeeded', result.txid);
    return { txid: result.txid };
  } catch (error) {
    await ledger.finishBrowserPayment(walletId, client, id, handedToNative ? 'unknown' : 'failed');
    if (error instanceof PhoneWalletError) throw error;
    if (handedToNative)
      throw new PhoneWalletError('OTHER', 'Submission outcome is unknown. Check wallet history.');
    throw new PhoneWalletError('RESTRICTED', 'Payment was not approved or could not be submitted.');
  }
}
