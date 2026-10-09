// The Agent wallet's Spark account: the main Spark adapter at the next account
// index. It is never registered with the protocol manager, so it stays out of
// balances, Send and Activity, and only the agent wallet code can move its funds.

import { MobileSparkAdapter } from '../protocols/MobileSparkAdapter';
import { AGENT_SPARK_ACCOUNT_INDEX, MAIN_SPARK_ACCOUNT_INDEX, sparkIdentityPubkey, walletSeed } from './derivation';
import type { AgentPayWallet } from './agentPay';

/** What the agent wallet code needs from a Spark account (the agent's or the main one). */
export interface SparkAccountLike {
  network: string;
  sparkAddress(): Promise<string>;
  balanceSats(): Promise<number>;
  /** Spark-to-Spark transfer; Spark charges no fee for these. */
  sendToSpark(address: string, sats: number): Promise<{ id: string; status: 'confirmed' | 'pending' | 'failed' }>;
}

export interface AgentSparkLoaders {
  /** The WDK Spark wallet manager module. */
  walletModule: () => any;
  /** spark-sdk, for the address helpers the adapter's send path uses. */
  sparkSdk: () => any;
}

const DEFAULT_LOADERS: AgentSparkLoaders = {
  walletModule: () => require('@tetherto/wdk-wallet-spark'),
  sparkSdk: () => require('@buildonspark/spark-sdk'),
};

const SPARK_NETWORKS: Record<string, string> = { mainnet: 'MAINNET', testnet: 'TESTNET', regtest: 'REGTEST', signet: 'SIGNET' };

export class AgentSparkAdapter extends MobileSparkAdapter {
  constructor(private readonly loaders: AgentSparkLoaders = DEFAULT_LOADERS) {
    super();
  }

  /**
   * Opens account index 1 directly instead of through the engine's connect,
   * which would hand the wallet to the Spark client Flashnet shares. That
   * client never sees this wallet, not even for a moment.
   */
  async connect(config: any): Promise<void> {
    const mnemonic = String(config?.mnemonic ?? '');
    const network = String(config?.network ?? 'mainnet');
    await this.releasePreviousConnection();
    const expected = sparkIdentityPubkey(mnemonic, network, AGENT_SPARK_ACCOUNT_INDEX);
    const mod = this.loaders.walletModule();
    const WalletManagerSpark = mod?.default ?? mod;
    this.manager = new WalletManagerSpark(walletSeed(mnemonic), { network: SPARK_NETWORKS[network] ?? 'MAINNET' });
    this.mnemonic = mnemonic;
    this.network = network;
    try {
      this.account = await this.manager.getAccount(AGENT_SPARK_ACCOUNT_INDEX);
      const actual = String((await this.account.getIdentityKey()) ?? '').toLowerCase();
      if (actual !== expected || actual === sparkIdentityPubkey(mnemonic, network, MAIN_SPARK_ACCOUNT_INDEX)) {
        throw new Error('The Agent wallet did not open on its own account. Nothing was changed.');
      }
      (this as any).identityPubKeyHex = actual;
      (this as any).sdk = this.loaders.sparkSdk();
      this.connected = true;
    } catch (e) {
      await this.disconnect().catch(() => {});
      throw e;
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
