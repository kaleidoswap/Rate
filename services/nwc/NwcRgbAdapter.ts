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

/** SecureStore key holding the RGB wallet's NWC connection string. Exported so
 *  protocol init can soft-skip RGB when the user hasn't paired a node yet. */
export const NWC_CONNECTION_KEY = 'nwc_connection_string';

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
  /** Whether the connected NWC wallet is a KaleidoSwap RGB Lightning Node
   *  (supports rln_* methods) vs a plain Lightning wallet (NIP-47 only). */
  private isRln = false;

  // ── lifecycle ──────────────────────────────────────────────────────────
  async connect(config: BaseProtocolConfig): Promise<void> {
    this.network = config.network ?? this.network;
    const uri = await SecureStore.getItemAsync(NWC_CONNECTION_KEY);
    if (!uri) {
      throw new Error('No NWC connection string configured for the RGB wallet');
    }
    parseNwcUri(uri); // validate
    this.client = new NWCClient(uri, { timeoutMs: 60_000 });

    // Detect the wallet type from the standard NIP-47 get_info (works for both
    // plain Lightning wallets and RLN nodes). RLN nodes advertise rln_* methods.
    const info = await this.client.getInfo();
    this.isRln = (info.methods ?? []).some((m) => m.startsWith('rln_'));
    this.nodePubkey = info.pubkey;

    // Fallback: some hubs don't list rln_* in get_info (older builds emit only
    // the standard NIP-47 methods). Actively probe rln_node_info — if the hub
    // answers, it's an RGB Lightning Node and the connection permits RGB ops.
    if (!this.isRln) {
      try {
        const rln = anyRec(await this.client.rlnNodeInfo());
        if (rln.pubkey) {
          this.isRln = true;
          this.nodePubkey = rln.pubkey;
        }
      } catch {
        /* not an RLN node, or rln_node_info not allowed → plain LN wallet */
      }
    } else {
      // Best-effort enrich the node id for RLN; never fail the connection on it.
      try {
        const rln = anyRec(await this.client.rlnNodeInfo());
        if (rln.pubkey) this.nodePubkey = rln.pubkey;
      } catch {
        /* ignore — get_info already succeeded */
      }
    }
    this.connected = true;
  }

  /** 'rln' for a KaleidoSwap RGB Lightning Node, 'ln' for a plain LN wallet. */
  walletType(): 'ln' | 'rln' {
    return this.isRln ? 'rln' : 'ln';
  }

  /** Guard for RGB/RLN-only operations against a plain Lightning wallet. */
  private requireRln(): void {
    if (!this.isRln) {
      throw new Error(
        'This wallet is a plain Lightning wallet and does not support RGB assets.',
      );
    }
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
      metadata: { walletType: this.walletType() },
    } as ConnectionInfo;
  }

  private c(): NWCClient {
    if (!this.client) throw new Error('NWC RGB adapter is not connected');
    return this.client;
  }

  // ── assets / balances ──────────────────────────────────────────────────
  private mapAssetBalance(raw: Record<string, any>, precision: number): AssetBalance {
    // RLN /assetbalance & /listassets report five fields. Mirror the rate-extension
    // display semantics: an asset's holdings = the on-chain leg (`future`, falling
    // back to `settled`) PLUS what's held in Lightning channels (`offchain_outbound`).
    // NB: use explicit Number()+|| — NOT `??` — because the node returns a real `0`
    // for empty legs, and `0 ?? x` keeps the 0 (so an in-channel-only asset that has
    // spendable:0 but offchain_outbound:Y would otherwise read as zero).
    const settled = Number(raw.settled) || 0;
    const future = Number(raw.future) || 0;
    const onchainSpendable = Number(raw.spendable) || 0;
    const offchainOutbound = Number(raw.offchain_outbound) || 0; // LN liquidity held
    const offchainInbound = Number(raw.offchain_inbound) || 0; // LN receive capacity
    const onchain = future || settled;
    const total = onchain + offchainOutbound;
    // Immediately usable = on-chain spendable + what can be sent over Lightning.
    const available = onchainSpendable + offchainOutbound;
    return {
      total,
      available,
      pending: future,
      // Extra RGB breakdown fields consumed by the dashboard/asset screens.
      locked: offchainOutbound,
      offchain_outbound: offchainOutbound,
      offchain_inbound: offchainInbound,
      settled,
      totalDisplay: display(total, precision),
      availableDisplay: display(available, precision),
    } as AssetBalance;
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
    // Plain Lightning wallets have no RGB assets — expose BTC only, with the
    // live Lightning balance so the wallet still shows a usable balance.
    if (!this.isRln) {
      const { confirmed } = await this.getBtcBalance();
      return [
        {
          ...BTC_ASSET,
          balance: {
            total: confirmed,
            available: confirmed,
            pending: 0,
            totalDisplay: display(confirmed, 8),
            availableDisplay: display(confirmed, 8),
          },
        },
      ];
    }
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
    this.requireRln();
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
    if (!this.isRln) return []; // plain LN wallets don't expose channels over NWC
    const res = anyRec(await this.c().rlnListChannels());
    return Array.isArray(res.channels) ? res.channels : [];
  }

  async listPayments(): Promise<any> {
    if (!this.isRln) return { payments: [] };
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
      // RGB-over-Lightning invoice (a BOLT11 carrying an RGB asset). This rides
      // /lninvoice with asset_id + asset_amount — NOT /rgbinvoice (that's the
      // on-chain RGB invoice exposed via createRgbInvoice). The HTLC must carry
      // a minimum sat amount alongside the asset (matches rate-extension).
      this.requireRln();
      const RGB_HTLC_MIN_MSAT = 3_000_000; // 3000 sats
      const requestedMsat = request.amount && request.amount > 0 ? request.amount * 1000 : 0;
      const raw = anyRec(
        await this.c().rlnLnInvoice({
          asset_id: request.asset,
          ...(request.assetAmount != null && request.assetAmount > 0
            ? { asset_amount: request.assetAmount }
            : {}),
          amt_msat: Math.max(requestedMsat, RGB_HTLC_MIN_MSAT),
          expiry_sec: request.expirySeconds ?? 3600,
        })
      );
      return {
        invoice: raw.invoice ?? '',
        paymentHash: raw.payment_hash ?? '',
        amount: request.assetAmount,
        expiresAt: (raw.expiry_sec ?? request.expirySeconds ?? 0) * 1000,
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
    this.requireRln();
    return this.c().rlnRgbInvoice(params);
  }

  async decodeInvoice(invoice: string): Promise<DecodedInvoice> {
    // Plain Lightning wallets can't decode server-side (no rln_* methods). Return
    // a minimal descriptor — pay_invoice honours the amount embedded in the
    // BOLT11, so payment still works without an explicit decode.
    if (!this.isRln) {
      return { paymentHash: '', destination: invoice };
    }
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
    this.requireRln();
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
    this.requireRln();
    return this.c().rlnSendAsset(params);
  }

  async sendBtcOnchain(params: { address: string; amount: number; feeRate?: number }): Promise<any> {
    this.requireRln();
    return this.c().request('rln_send_btc', {
      address: params.address,
      amount: params.amount,
      fee_rate: params.feeRate ?? 1,
      skip_sync: false,
    });
  }

  async getReceiveAddress(assetId?: string): Promise<Address> {
    if (assetId) {
      this.requireRln();
      const raw = anyRec(await this.c().rlnRgbInvoice({ asset_id: assetId }));
      return {
        address: raw.invoice ?? raw.recipient_id ?? '',
        format: 'RGB_INVOICE',
        asset: assetId,
      };
    }
    // On-chain BTC address is only available from an RLN node over NWC.
    this.requireRln();
    const raw = anyRec(await this.c().rlnGetAddress());
    return { address: raw.address ?? '', format: 'BTC_ADDRESS' };
  }

  async getNodeInfo(): Promise<any> {
    return this.isRln ? this.c().rlnNodeInfo() : this.c().getInfo();
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
