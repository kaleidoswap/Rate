// The Agent wallet's Spark account: the main Spark adapter at the next account
// index. It is never registered with the protocol manager, so it stays out of
// balances, Send and Activity, and only the agent wallet code can move its funds.

import { MobileSparkAdapter } from '../protocols/MobileSparkAdapter';
import { AGENT_SPARK_ACCOUNT_INDEX, MAIN_SPARK_ACCOUNT_INDEX, sparkIdentityPubkey } from './derivation';
import type { AgentPayWallet } from './agentPay';

/** What the agent wallet code needs from a Spark account (the agent's or the main one). */
export interface SparkAccountLike {
  network: string;
  sparkAddress(): Promise<string>;
  balanceSats(): Promise<number>;
  /** Spark-to-Spark transfer; Spark charges no fee for these. */
  sendToSpark(address: string, sats: number): Promise<{ id: string; status: 'confirmed' | 'pending' | 'failed' }>;
}

type SparkGlue = { adoptExternalWallet(w: unknown, network: string): void; releaseExternalWallet(w: unknown): void };

export class AgentSparkAdapter extends MobileSparkAdapter {
  constructor(private readonly glue: SparkGlue, private readonly mainWallet: () => unknown) {
    super();
  }

  async connect(config: any): Promise<void> {
    const mnemonic = String(config?.mnemonic ?? '');
    const network = String(config?.network ?? 'mainnet');
    await super.connect({ ...config, accountIndex: AGENT_SPARK_ACCOUNT_INDEX });
    // The engine shares the connected Spark wallet with Flashnet; that stays the main one.
    const mine = this.account?._wallet;
    try { this.glue.releaseExternalWallet(mine); } catch { /* optional glue */ }
    const main = this.mainWallet();
    if (main && main !== mine) {
      try { this.glue.adoptExternalWallet(main, network); } catch { /* optional glue */ }
    }
    const expected = sparkIdentityPubkey(mnemonic, network, AGENT_SPARK_ACCOUNT_INDEX);
    const actual = String((await this.account.getIdentityKey()) ?? '').toLowerCase();
    if (actual !== expected || actual === sparkIdentityPubkey(mnemonic, network, MAIN_SPARK_ACCOUNT_INDEX)) {
      await this.disconnect().catch(() => {});
      throw new Error('The Agent wallet did not open on its own account. Nothing was changed.');
    }
  }

  get sparkNetwork(): string {
    return this.network;
  }

  async spendableSats(): Promise<number> {
    this.assertConnected();
    const b = await this.account._wallet.getBalance();
    const n = Number(b?.satsBalance?.available ?? b?.balance ?? NaN);
    if (!Number.isFinite(n) || n < 0) throw new Error('Could not read the Agent wallet balance.');
    return n;
  }
}

const transferStatus = (s: unknown): 'confirmed' | 'pending' | 'failed' =>
  s === 'confirmed' || s === 'failed' ? s : 'pending';

/** Any connected Spark adapter (main or agent) as a SparkAccountLike. */
export function sparkAccount(adapter: any, balance?: () => Promise<number>): SparkAccountLike {
  return {
    network: String(adapter.network ?? adapter.sparkNetwork ?? 'mainnet'),
    sparkAddress: async () => String((await adapter.getReceiveAddress('SPARK')).address),
    balanceSats: balance ?? (async () => Number((await adapter.getBtcBalance()).confirmed ?? 0)),
    sendToSpark: async (address, sats) => {
      const r = await adapter.sendPayment({ invoice: address, amount: sats });
      return { id: String(r?.paymentHash ?? ''), status: transferStatus(r?.status) };
    },
  };
}

/** The agent account as the payment gate sees it. */
export function agentPayWallet(adapter: AgentSparkAdapter): AgentPayWallet {
  return {
    network: adapter.sparkNetwork,
    balanceSats: () => adapter.spendableSats(),
    quoteLightningFee: (invoice) => adapter.quotePaymentFee({ method: 'lightning', destination: invoice, amountSats: 0 }),
    payInvoice: async (invoice, maxFeeSats) => {
      const r: any = await adapter.sendPayment({ invoice, maxFeeSats });
      return { preimage: r?.preimage, feeSats: r?.feeKnown !== false && Number.isFinite(Number(r?.fee)) ? Number(r.fee) : undefined, status: transferStatus(r?.status) };
    },
  };
}
