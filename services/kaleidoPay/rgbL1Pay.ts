/**
 * RGB on this phone as a way to pay: the engine's RGB_L1 adapter (rgb-lib through
 * react-native-rgb) seen through the same RgbPayAdapter shape the RGB node uses,
 * so Send's on-chain and RGB-asset accounts (./rgbPay.ts) work unchanged.
 *
 * No Lightning: only the on-chain bitcoin and RGB invoice accounts are registered.
 */
import type { Network } from './index';
import { connectRgbPayAccounts, type RgbPayAdapter } from './rgbPay';
import { rgbFeeRates } from '../rgbWallet';

const FEE_RATE_MAX_AGE_MS = 10 * 60_000;

/**
 * The network's "normal" fee rate for the wallet, read in the background at most
 * every 10 minutes; undefined until known, so callers fall back to their default.
 */
export function networkFeeRate(l1: any, now: () => number = Date.now): () => number | undefined {
  let rate: number | undefined;
  let at = -Infinity;
  return () => {
    if (now() - at > FEE_RATE_MAX_AGE_MS) {
      at = now();
      void rgbFeeRates(l1).then((r) => { if (r.live) rate = r.normal; });
    }
    return rate;
  };
}

/** The node-shaped view of the RGB_L1 adapter. */
export function rgbL1PayAdapter(l1: any, feeRate: () => number | undefined = () => undefined): RgbPayAdapter {
  return {
    isConnected: () => !!l1?.isConnected?.(),
    getBtcBalance: () => l1.getBtcBalance(),
    sendPayment: async () => { throw new Error('RGB on this phone has no Lightning.'); },
    getPaymentStatus: async () => ({ status: 'failed' }),
    sendBtcOnchain: (params) => l1.sendBtcOnchain(params),
    // rgb-lib decodes on the device; the answer is shaped like the node's.
    decodeRgbInvoice: ({ invoice }) => l1.account.decodeRgbInvoice(invoice),
    sendAsset: ({ asset_id, recipientId, amount }) => {
      const rate = feeRate();
      return l1.sendAsset({ token: asset_id, recipient: recipientId, amount, ...(rate ? { feeRate: rate } : {}) });
    },
    getAssetBalance: (assetId) => l1.getAssetBalance(assetId),
    getAsset: (assetId) => l1.getAsset(assetId),
    getTransaction: (txId) => l1.getTransaction(txId),
  };
}

/** Registers RGB on this phone with Send: on-chain bitcoin and RGB invoices, at the network's fee rate. */
export function connectRgbL1PayAccounts(l1: any, network: Network): () => void {
  const rate = networkFeeRate(l1);
  rate(); // start reading it now, ahead of the first send
  return connectRgbPayAccounts(rgbL1PayAdapter(l1, rate), network, { walletName: 'RGB wallet', lightning: false, feeRate: () => rate() ?? 0 });
}
