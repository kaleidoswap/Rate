/**
 * RGB on this phone as a way to pay: the engine's RGB_L1 adapter (rgb-lib through
 * react-native-rgb) seen through the same RgbPayAdapter shape the RGB node uses,
 * so Send's on-chain and RGB-asset accounts (./rgbPay.ts) work unchanged.
 *
 * No Lightning: only the on-chain bitcoin and RGB invoice accounts are registered.
 */
import type { Network } from './index';
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
    getBtcBalance: () => l1.getBtcBalance(),
    sendPayment: async () => { throw new Error('RGB on this phone has no Lightning.'); },
    getPaymentStatus: async () => ({ status: 'failed' }),
    sendBtcOnchain: (params) => l1.sendBtcOnchain(params),
    // rgb-lib decodes on the device; the answer is shaped like the node's.
    decodeRgbInvoice: ({ invoice }) => l1.account.decodeRgbInvoice(invoice),
    sendAsset: ({ asset_id, recipientId, amount, feeRate: chosen }) => {
      const rate = chosen ?? feeRate();
      return l1.sendAsset({ token: asset_id, recipient: recipientId, amount, ...(rate ? { feeRate: rate } : {}) });
    },
    getAssetBalance: (assetId) => l1.getAssetBalance(assetId),
    getAsset: (assetId) => l1.getAsset(assetId),
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
