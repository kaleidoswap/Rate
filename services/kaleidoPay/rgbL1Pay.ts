/**
 * RGB on this phone as a way to pay: the engine's RGB_L1 adapter (rgb-lib through
 * modules/kaleido-rgb) seen through the same RgbPayAdapter shape the RGB node uses,
 * so Send's on-chain and RGB-asset accounts (./rgbPay.ts) work unchanged.
 *
 * No Lightning: only the on-chain bitcoin and RGB invoice accounts are registered.
 */
import { PaymentNotSentError, PaymentUncertainError } from './errors';
import type { Network, PaymentResult } from './index';
import { RGB_ONCHAIN_VBYTES, connectRgbPayAccounts, type RgbPayAdapter } from './rgbPay';
import { DEFAULT_RGB_FEE_RATES, rgbFeeRates, type RgbFeeRates } from '../rgbWallet';

const FEE_RATE_MAX_AGE_MS = 10 * 60_000;

export type RgbFeeSpeed = 'slow' | 'normal' | 'fast';
export const RGB_FEE_SPEEDS: RgbFeeSpeed[] = ['slow', 'normal', 'fast'];

/**
 * The network's fee rates for the wallet, read in the background at most every
 * 10 minutes; undefined until known, so callers fall back to the defaults.
 */
export function networkFeeRates(l1: any, now: () => number = Date.now): () => RgbFeeRates | undefined {
  let rates: RgbFeeRates | undefined;
  let at = -Infinity;
  return () => {
    if (now() - at > FEE_RATE_MAX_AGE_MS) {
      at = now();
      void rgbFeeRates(l1).then((r) => { if (r.live) rates = r; });
    }
    return rates;
  };
}

// The speed Send pays RGB on this phone at; Normal unless the review picks another.
let speed: RgbFeeSpeed = 'normal';
let connected: { rates: () => RgbFeeRates | undefined } | null = null;

export function setRgbL1FeeSpeed(next: RgbFeeSpeed): void { speed = next; }
export function rgbL1FeeSpeed(): RgbFeeSpeed { return speed; }

export interface RgbFeeOption { speed: RgbFeeSpeed; rate: number; feeSat: number; live: boolean }

/** Slow, Normal and Fast with their estimated fee, while RGB on this phone is Send's RGB wallet; else null. */
export function rgbL1FeeOptions(): RgbFeeOption[] | null {
  if (!connected) return null;
  const rates = connected.rates() ?? DEFAULT_RGB_FEE_RATES;
  return RGB_FEE_SPEEDS.map((s) => ({ speed: s, rate: rates[s], feeSat: Math.ceil(rates[s] * RGB_ONCHAIN_VBYTES), live: rates.live }));
}

/** The node-shaped view of the RGB_L1 adapter. */
export function rgbL1PayAdapter(l1: any, feeRate: () => number | undefined = () => undefined): RgbPayAdapter {
  return {
    isConnected: () => !!l1?.isConnected?.(),
    // The native adapter's total is spendable vanilla BTC; settled may include
    // inputs already committed to a pending transaction.
    getBtcBalance: async () => {
      const balance = await l1.getBtcBalance();
      return { confirmed: Number(balance.total ?? balance.confirmed) };
    },
    sendPayment: async () => { throw new Error('RGB on this phone has no Lightning.'); },
    getPaymentStatus: async () => ({ status: 'failed' }),
    sendBtcOnchain: (params) => l1.sendBtcOnchain(params),
    // rgb-lib decodes on the device; the answer is shaped like the node's.
    decodeRgbInvoice: ({ invoice }) => l1.account.decodeRgbInvoice(invoice),
    sendAsset: async ({ asset_id, recipientId, amount, feeRate: chosen }) => {
      const rate = chosen ?? feeRate();
      try {
        return await l1.sendAsset({ token: asset_id, recipient: recipientId, amount, ...(rate ? { feeRate: rate } : {}) });
      } catch (error: any) {
        // Only definite validation/preparation failures are safe to call unpaid.
        // Transport errors and timeouts must remain unknown: never auto-resend.
        if (error?.code === 'RGB_INVOICE_INVALID') throw new PaymentNotSentError(error.message);
        if (error?.code === 'ERR_RGB_INSUFFICIENT_ALLOCATION_SLOTS') {
          throw new PaymentNotSentError('Your RGB wallet needs a free output for asset change. Open RGB wallet tools → UTXOs, create outputs and wait for confirmation.');
        }
        if (error?.code === 'ERR_RGB_INSUFFICIENT_BITCOINS') {
          throw new PaymentNotSentError('Not enough bitcoin for the RGB transfer and network fee. Add bitcoin to this RGB wallet on the selected network.');
        }
        if (error?.code === 'ERR_RGB_INSUFFICIENT_ASSIGNMENTS') {
          throw new PaymentNotSentError('Not enough spendable RGB assets. Some assets may be reserved by a pending transfer. Sync your wallet and check Activity.');
        }
        if (error?.code === 'ERR_RGB_INVALID_TRANSPORT_ENDPOINTS') {
          throw new PaymentNotSentError('The invoice’s RGB delivery service could not be reached. Check your connection and ask the recipient for a fresh invoice.');
        }
        const code = typeof error?.code === 'string' && /^ERR_RGB_[A-Z_]+$/.test(error.code) ? ` (${error.code})` : '';
        throw new PaymentUncertainError(`The RGB wallet could not confirm submission${code}. Check your connection and verify this payment in Activity. Do not send again until its status is known.`);
      }
    },
    listAssets: () => l1.listAssets(),
    getAssetBalance: (assetId) => l1.getAssetBalance(assetId),
    getAsset: (assetId) => l1.getAsset(assetId),
    getRgbTransferStatus: (txId) => rgbL1TransferStatus(l1, txId),
    getTransaction: (txId) => l1.getTransaction(txId),
  };
}

/** Registers RGB on this phone with Send: on-chain bitcoin and RGB invoices, at the network's rate for the chosen speed. */
export function connectRgbL1PayAccounts(l1: any, network: Network): () => void {
  const rates = networkFeeRates(l1);
  rates(); // start reading them now, ahead of the first send
  const rate = () => (rates() ?? DEFAULT_RGB_FEE_RATES)[speed];
  const context = { rates };
  connected = context;
  const off = connectRgbPayAccounts(rgbL1PayAdapter(l1, rate), network, { walletName: 'RGB wallet', lightning: false, feeRate: rate });
  return () => {
    off();
    if (connected === context) connected = null;
  };
}

/** RGB send only posts the consignment. Refresh receives the ACK and broadcasts
 * the signed transaction; Bitcoin history alone cannot advance this handshake.
 * Read transfers again after refresh, including after restarting the app.
 */
export async function rgbL1TransferStatus(l1: any, txid: string): Promise<PaymentResult> {
  await l1.account.refreshTransfers();
  const assets = await l1.listAssets();
  for (const asset of assets.filter((a: { id: string }) => a.id !== 'BTC')) {
    const transfers = await l1.account.listTransfers(asset.id);
    const transfer = transfers.find((t: any) => t.txid === txid);
    if (!transfer) continue;
    const status = String(transfer.status).replace(/[_-]/g, '').toLowerCase();
    if (status === 'settled') return { status: 'completed', reference: txid, detail: 'The recipient accepted your RGB transfer and it is confirmed on-chain.' };
    if (status === 'failed') return { status: 'failed', reference: txid, detail: 'The RGB transfer failed. Review the transfer in Activity before trying again.' };
    if (status === 'waitingcounterparty') return { status: 'pending', reference: txid, detail: 'Waiting for the recipient to accept the RGB transfer. Ask them to open and sync their wallet. Keep this wallet open to complete the transfer. Do not send again.' };
    if (status === 'waitingsafeheight') return { status: 'pending', reference: txid, detail: 'Waiting for the Bitcoin safety height before broadcasting the RGB transfer. Keep this wallet open. Do not send again.' };
    if (status === 'waitingbroadcast') return { status: 'pending', reference: txid, detail: 'RGB transfer accepted; waiting for the Bitcoin transaction to be broadcast. Keep this wallet open. Do not send again.' };
    if (status === 'waitingconfirmations') return { status: 'pending', reference: txid, detail: 'The recipient accepted the RGB transfer. Waiting for Bitcoin confirmations. Do not send again.' };
  }
  return { status: 'pending', reference: txid, detail: 'RGB transfer status is not available yet. Check again later. Do not send again.' };
}
