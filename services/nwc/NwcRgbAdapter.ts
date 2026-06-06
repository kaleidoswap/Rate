/**
 * NWC-backed RGB protocol adapter.
 *
 * Implements the wallet-engine `IProtocolAdapter` for the 'RGB' protocol by
 * driving a remote RGB Lightning Node entirely over Nostr Wallet Connect
 * (NIP-47) — no direct HTTP `nodeUrl`. Used on mobile when the wallet is
 * configured to reach RLN via an NWC connection string (the desktop hub).
 *
 * It maps the adapter surface to the {@link NWCClient}: standard NIP-47 methods
 * for Lightning, and the `rln_*` extension methods for RGB/node operations
 * (whose results are the raw rgb-lightning-node responses).
 *
 * NOTE: the raw-RLN → Unified* conversions below are best-effort and read
 * fields defensively; they should be verified against live node responses.
 */

import * as SecureStore from 'expo-secure-store';
import type {
  IProtocolAdapter,
  BaseProtocolConfig,
  ProtocolType,
  Layer,
  UnifiedAsset,
  UnifiedTransaction,
  AssetBalance,
  InvoiceRequest,
  Invoice,
  DecodedInvoice,
  PaymentRequest,
  PaymentResult,
  PaymentStatus,
  Address,
  ConnectionInfo,
  TransactionFilter,
} from '@kaleidorg/wallet-engine';

import { NWCClient, parseNwcUri } from './NWCExternalClient';

const NWC_CONNECTION_KEY = 'nwc_connection_string';

const anyRec = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? (v as Record<string, any>) : {};

function display(amount: number, precision: number): string {
  if (!precision) return String(amount);
  return (amount / Math.pow(10, precision)).toString();
}

/** A synthetic BTC asset used to tag Lightning transactions. */
const BTC_ASSET: UnifiedAsset = {
  id: 'BTC',
  name: 'Bitcoin',
  ticker: 'BTC',
  precision: 8,
  protocol: 'RGB',
  layer: 'BTC_LN',
  balance: {
    total: 0,
    available: 0,
    pending: 0,
    totalDisplay: '0',
    availableDisplay: '0',
  },
  capabilities: {
    canSend: true,
    canReceive: true,
    canSwap: false,
    supportsLightning: true,
    supportsOnchain: true,
  },
};

export class NwcRgbAdapter implements IProtocolAdapter {
  readonly protocolName: ProtocolType = 'RGB';
  readonly supportedLayers: Layer[] = ['BTC_LN', 'RGB_LN', 'BTC_L1', 'RGB_L1'];
  readonly version = '0.1.0-nwc';

  private client?: NWCClient;
  private connected = false;
  private network = 'regtest';
  private nodePubkey?: string;

  // ── lifecycle ──────────────────────────────────────────────────────────
  async connect(config: BaseProtocolConfig): Promise<void> {
    this.network = config.network ?? this.network;
    const uri = await SecureStore.getItemAsync(NWC_CONNECTION_KEY);
    if (!uri) {
      throw new Error('No NWC connection string configured for the RGB wallet');
    }
    parseNwcUri(uri); // validate
    this.client = new NWCClient(uri, { timeoutMs: 60_000 });
    const info = anyRec(await this.client.rlnNodeInfo());
    this.nodePubkey = info.pubkey;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.client?.close();
    this.client = undefined;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getConnectionInfo(): Promise<ConnectionInfo> {
    return {
      protocol: 'RGB',
      connected: this.connected,
      nodeId: this.nodePubkey,
      network: this.network,
    };
  }

  private c(): NWCClient {
    if (!this.client) throw new Error('NWC RGB adapter is not connected');
    return this.client;
  }

  // ── assets / balances ──────────────────────────────────────────────────
  private mapAssetBalance(raw: Record<string, any>, precision: number): AssetBalance {
    const spendable = Number(raw.spendable ?? raw.offchain_outbound ?? raw.settled ?? 0);
    const pending = Number(raw.future ?? 0);
    const total = spendable + Number(raw.offchain_inbound ?? 0);
    return {
      total,
      available: spendable,
      pending,
      totalDisplay: display(total, precision),
      availableDisplay: display(spendable, precision),
    };
  }

  private toUnifiedAsset(raw: Record<string, any>): UnifiedAsset {
    const precision = Number(raw.precision ?? 0);
    return {
      id: raw.asset_id ?? raw.id,
      name: raw.name ?? raw.ticker ?? raw.asset_id,
      ticker: raw.ticker ?? raw.name ?? '',
      precision,
      protocol: 'RGB',
      layer: 'RGB_LN',
      balance: this.mapAssetBalance(anyRec(raw.balance), precision),
      capabilities: {
        canSend: true,
        canReceive: true,
        canSwap: true,
        supportsLightning: true,
        supportsOnchain: true,
      },
      metadata: raw,
    };
  }

  async listAssets(): Promise<UnifiedAsset[]> {
    const res = anyRec(await this.c().rlnListAssets());
    const groups = ['nia', 'cfa', 'uda', 'ifa'];
    const out: UnifiedAsset[] = [];
    for (const g of groups) {
      const arr = Array.isArray(res[g]) ? (res[g] as unknown[]) : [];
      for (const a of arr) out.push(this.toUnifiedAsset(anyRec(a)));
    }
    return out;
  }

  async getAsset(assetId: string): Promise<UnifiedAsset> {
    const all = await this.listAssets();
    const found = all.find((a) => a.id === assetId);
    if (!found) throw new Error(`Asset ${assetId} not found`);
    return found;
  }

  async getAssetBalance(assetId: string): Promise<UnifiedAsset['balance']> {
    const raw = anyRec(await this.c().rlnAssetBalance({ asset_id: assetId }));
    return this.mapAssetBalance(raw, 0);
  }

  async refreshBalances(): Promise<void> {
    // Balances are fetched live; nothing to refresh.
  }

  async getBtcBalance(): Promise<{ confirmed: number; unconfirmed: number; total: number }> {
    const { balance } = await this.c().getBalance(); // millisats
    const sats = Math.floor(balance / 1000);
    return { confirmed: sats, unconfirmed: 0, total: sats };
  }

  // ── transactions ─────────────────────────────────────────────────────────
  async listTransactions(filter?: TransactionFilter): Promise<UnifiedTransaction[]> {
    const txns = await this.c().listTransactions(
      filter?.limit ? { limit: filter.limit, offset: filter.offset } : {}
    );
    return txns.map((t) => {
      const incoming = t.type === 'incoming';
      const amount = Math.floor((t.amount ?? 0) / 1000);
      return {
        id: t.payment_hash ?? '',
        type: incoming ? 'receive' : 'send',
        status:
          t.state === 'settled'
            ? 'confirmed'
            : t.state === 'failed'
              ? 'failed'
              : 'pending',
        timestamp: (t.created_at ?? 0) * 1000,
        amount,
        amountDisplay: display(amount, 8),
        fee: t.fees_paid ? Math.floor(t.fees_paid / 1000) : undefined,
        asset: BTC_ASSET,
        protocolData: t as unknown as Record<string, any>,
      } as UnifiedTransaction;
    });
  }

  async getTransaction(txId: string): Promise<UnifiedTransaction> {
    const all = await this.listTransactions();
    const found = all.find((t) => t.id === txId);
    if (!found) throw new Error(`Transaction ${txId} not found`);
    return found;
  }

  async listChannels(): Promise<any[]> {
    const res = anyRec(await this.c().rlnListChannels());
    return Array.isArray(res.channels) ? res.channels : [];
  }

  async listPayments(): Promise<any> {
    return this.c().request('rln_list_payments', {});
  }

  async listTransfers(options?: { asset_id?: string }): Promise<any> {
    // Not exposed over NWC yet; return empty list rather than throwing.
    void options;
    return { transfers: [] };
  }

  // ── invoices / payments ───────────────────────────────────────────────────
  async createInvoice(request: InvoiceRequest): Promise<Invoice> {
    if (request.asset) {
      const raw = anyRec(
        await this.c().rlnRgbInvoice({
          asset_id: request.asset,
          ...(request.assetAmount != null ? { asset_amount: request.assetAmount } : {}),
        })
      );
      return {
        invoice: raw.invoice ?? raw.recipient_id ?? '',
        paymentHash: raw.recipient_id ?? '',
        amount: request.assetAmount,
        expiresAt: (raw.expiration_timestamp ?? 0) * 1000,
        description: request.description,
      };
    }
    const inv = await this.c().makeInvoice({
      amount: (request.amount ?? 0) * 1000, // sats → msat
      description: request.description,
      expiry: request.expirySeconds,
    });
    return {
      invoice: inv.invoice ?? '',
      paymentHash: inv.payment_hash ?? '',
      amount: request.amount,
      expiresAt: (inv.created_at ?? 0) * 1000,
      description: request.description,
    };
  }

  async createRgbInvoice(params: any): Promise<any> {
    return this.c().rlnRgbInvoice(params);
  }

  async decodeInvoice(invoice: string): Promise<DecodedInvoice> {
    const isRgb = invoice.toLowerCase().includes('rgb');
    if (isRgb) {
      const raw = anyRec(await this.c().rlnDecodeRgbInvoice({ invoice }));
      return {
        paymentHash: raw.recipient_id ?? '',
        destination: raw.recipient_id ?? '',
        expiresAt: (raw.expiration_timestamp ?? 0) * 1000,
        asset_id: raw.asset_id,
        asset_amount: raw.assignment,
      };
    }
    const raw = anyRec(await this.c().request('rln_decode_ln_invoice', { invoice }));
    const amountMsat = Number(raw.amt_msat ?? 0);
    return {
      paymentHash: raw.payment_hash ?? '',
      payment_hash: raw.payment_hash,
      amountMsat,
      amount_msat: amountMsat,
      amount: amountMsat ? Math.floor(amountMsat / 1000) : undefined,
      destination: raw.payee_pubkey ?? '',
      payee_pubkey: raw.payee_pubkey,
      asset_id: raw.asset_id,
      asset_amount: raw.asset_amount,
      expiresAt: (raw.timestamp ?? 0) * 1000 + (raw.expiry_sec ?? 0) * 1000,
    };
  }

  async decodeRgbInvoice(params: any): Promise<any> {
    return this.c().rlnDecodeRgbInvoice(params);
  }

  async getInvoiceStatus(params: { invoice: string }): Promise<any> {
    return this.c().lookupInvoice({ invoice: params.invoice });
  }

  async sendPayment(request: PaymentRequest): Promise<PaymentResult> {
    const res = await this.c().payInvoice({
      invoice: request.invoice,
      ...(request.amount != null ? { amount: request.amount * 1000 } : {}),
    });
    return {
      paymentHash: '',
      preimage: res.preimage,
      amount: request.amount ?? 0,
      fee: res.fees_paid ? Math.floor(res.fees_paid / 1000) : 0,
      status: 'confirmed',
      timestamp: Date.now(),
    };
  }

  async getPaymentStatus(paymentHash: string): Promise<PaymentStatus> {
    const raw = anyRec(await this.c().lookupInvoice({ payment_hash: paymentHash }));
    return {
      paymentHash,
      status: raw.state === 'settled' ? 'confirmed' : raw.state === 'failed' ? 'failed' : 'pending',
      amount: raw.amount ? Math.floor(raw.amount / 1000) : undefined,
      timestamp: raw.settled_at ? raw.settled_at * 1000 : undefined,
    };
  }

  async sendAsset(params: any): Promise<any> {
    return this.c().rlnSendAsset(params);
  }

  async sendBtcOnchain(params: { address: string; amount: number; feeRate?: number }): Promise<any> {
    return this.c().request('rln_send_btc', {
      address: params.address,
      amount: params.amount,
      fee_rate: params.feeRate ?? 1,
      skip_sync: false,
    });
  }

  async getReceiveAddress(assetId?: string): Promise<Address> {
    if (assetId) {
      const raw = anyRec(await this.c().rlnRgbInvoice({ asset_id: assetId }));
      return {
        address: raw.invoice ?? raw.recipient_id ?? '',
        format: 'RGB_INVOICE',
        asset: assetId,
      };
    }
    const raw = anyRec(await this.c().rlnGetAddress());
    return { address: raw.address ?? '', format: 'BTC_ADDRESS' };
  }

  async getNodeInfo(): Promise<any> {
    return this.c().rlnNodeInfo();
  }

  // ── swaps (not over NWC) ───────────────────────────────────────────────────
  supportsSwaps(): boolean {
    return false;
  }

  async executeProtocolOperation(operation: string, params: any): Promise<any> {
    if (operation.startsWith('rln_')) {
      return this.c().request(operation as never, anyRec(params));
    }
    throw new Error(`Operation '${operation}' is not supported over NWC`);
  }
}
