/**
 * RGB on this phone as a way to pay: the engine's RGB_L1 adapter (rgb-lib through
 * modules/kaleido-rgb) seen through the same RgbPayAdapter shape the RGB node uses,
 * so Send's on-chain and RGB-asset accounts (./rgbPay.ts) work unchanged.
 *
 * No Lightning: only the on-chain bitcoin and RGB invoice accounts are registered.
 */
import type { Network } from './index';
import { connectRgbPayAccounts, type RgbPayAdapter } from './rgbPay';

/** The node-shaped view of the RGB_L1 adapter. */
export function rgbL1PayAdapter(l1: any): RgbPayAdapter {
  return {
    isConnected: () => !!l1?.isConnected?.(),
    getBtcBalance: () => l1.getBtcBalance(),
    sendPayment: async () => { throw new Error('RGB on this phone has no Lightning.'); },
    getPaymentStatus: async () => ({ status: 'failed' }),
    sendBtcOnchain: (params) => l1.sendBtcOnchain(params),
    // rgb-lib decodes on the device; the answer is shaped like the node's.
    decodeRgbInvoice: ({ invoice }) => l1.account.decodeRgbInvoice(invoice),
    sendAsset: ({ asset_id, recipientId, amount }) => l1.sendAsset({ token: asset_id, recipient: recipientId, amount }),
    getAssetBalance: (assetId) => l1.getAssetBalance(assetId),
    getAsset: (assetId) => l1.getAsset(assetId),
    getTransaction: (txId) => l1.getTransaction(txId),
  };
}

/** Registers RGB on this phone with Send: on-chain bitcoin and RGB invoices. */
export function connectRgbL1PayAccounts(l1: any, network: Network): () => void {
  return connectRgbPayAccounts(rgbL1PayAdapter(l1), network, { walletName: 'RGB wallet', lightning: false });
}
