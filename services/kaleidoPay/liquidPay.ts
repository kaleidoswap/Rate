import { registerKaleidoPayAccount } from './index';
import type { AccountQuoteOption, Network, PayAccount, Preview } from './index';
import { createDirectAccount, notEnough, resultOf } from './sparkPay';

/** The part of LiquidWdkAdapter (protocolManager 'LIQUID') this account uses. */
export interface LiquidPayAdapter {
  isConnected?(): boolean;
  getBtcBalance(): Promise<{ confirmed: number }>;
  /** L-BTC send; `invoice` carries the Liquid address, and the result's paymentHash is the txid. */
  sendPayment(request: { invoice: string; amount: number }): Promise<{ paymentHash: string; status: string }>;
  getPaymentStatus(txid: string): Promise<{ status: string }>;
}

/**
 * The Liquid wallet cannot quote a fee before sending. A confidential transaction without
 * the CT discount is ~2,600 vB at Liquid's 0.1 sat/vB floor; 300 sats covers it with margin.
 */
export const LIQUID_FEE_ESTIMATE_SAT = 300;
export const LIQUID_LIGHTNING_UNAVAILABLE = 'No Liquid → Lightning provider yet';

export function createLiquidPayAccount(liquid: LiquidPayAdapter, network: Network): PayAccount {
  return createDirectAccount<{ address: string }>({
    id: 'liquid', rail: 'liquid', network, walletName: 'Liquid', optionName: 'Liquid', estimatedSeconds: 120,
    isConnected: () => liquid.isConnected?.() ?? true,
    async prepare(preview) {
      const address = preview.code.liquidAddress;
      if (!address) throw new Error('The request has no Liquid address.');
      const balance = Number((await liquid.getBtcBalance())?.confirmed);
      if (!Number.isFinite(balance)) throw new Error('Could not read your Liquid balance. Try again.');
      const feeSat = LIQUID_FEE_ESTIMATE_SAT;
      if (preview.request.amountSat + feeSat > Math.floor(balance)) throw notEnough('Liquid');
      return { feeSat, terms: { address }, detail: 'Estimated network fee; the actual fee is usually lower' };
    },
    matches: (preview, terms) => preview.code.liquidAddress === terms.address,
    async send(terms, quote) {
      const sent = await liquid.sendPayment({ invoice: terms.address, amount: quote.recipientSat });
      // Broadcast, not yet confirmed: the txid is the reference to follow.
      return sent?.paymentHash ? { status: 'pending', reference: sent.paymentHash } : { status: 'unknown' };
    },
    follow: async txid => resultOf((await liquid.getPaymentStatus(txid))?.status, txid),
  });
}

let liquidConnection: object | null = null;

/**
 * Liquid pays Lightning only through a swap provider, and none is wired yet: no route is
 * registered, so the UI shows this option as unavailable when a Lightning request could
 * otherwise have been paid from Liquid.
 */
export function liquidLightningOption(preview: Preview): AccountQuoteOption | undefined {
  if (!liquidConnection || !preview.request.acceptedRails.some(r => r.split(':')[0] === 'ln')) return undefined;
  return { id: 'liquid-ln', name: 'Liquid → Lightning', unavailable: LIQUID_LIGHTNING_UNAVAILABLE };
}

export function connectLiquidPayAccounts(liquid: LiquidPayAdapter, network: Network): () => void {
  const unregister = registerKaleidoPayAccount(createLiquidPayAccount(liquid, network));
  const connection = {};
  liquidConnection = connection;
  return () => { unregister(); if (liquidConnection === connection) liquidConnection = null; };
}
