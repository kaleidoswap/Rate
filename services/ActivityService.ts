// services/ActivityService.ts
//
// Aggregates wallet activity across every available source into a single,
// timestamp-sorted list of {@link ActivityItem}. This is the React Native
// counterpart of the browser extension's `use-activity-data` hook, but it
// pulls from the shared `@kaleidorg/wallet-engine` ProtocolManager adapters
// instead of the extension's background API.
//
// Sources, in priority order:
//   1. Lightning payments (BTC LN + RGB LN) — RGB adapter `listPayments()`
//   2. RGB on-chain transfers (per asset)   — RGB adapter `listTransfers()`
//   3. Spark / Arkade unified transactions   — adapter `listTransactions()`
//   4. KaleidoSwap atomic swaps              — provided from Redux swap history
//   5. Electrum swap payments (on-chain)     — provided from KaleidoPay attempts
//
// Every source is fetched defensively: a failure in one never blocks the rest.

import { protocolManager, rgbAccountAdapter } from './protocols';

export type ActivityLayer = 'L1' | 'RGB-L1' | 'LN' | 'RGB-LN' | 'Spark' | 'Arkade' | 'Bark' | 'Bark Signet' | 'Swap';

export type ActivityItemType =
  | 'send'
  | 'receive'
  | 'swap'
  | 'channel_open'
  | 'channel_close'
  | 'issuance';

import type { ActivityStatus } from '../utils/paymentStatus';
export type { ActivityStatus } from '../utils/paymentStatus';

export interface ActivityItem {
  id: string;
  type: ActivityItemType;
  source: 'payment' | 'onchain' | 'transfer' | 'swap';
  /** Asset id, or 'BTC' for the base layer. */
  asset: string;
  assetName?: string;
  assetTicker: string;
  assetPrecision: number;
  /** Pre-formatted, human-readable amount string. */
  amount: string;
  /** Raw satoshi amount for BTC items (used when re-formatting units). */
  rawSats?: number;
  status: ActivityStatus;
  timestamp?: number;
  txid: string;
  layer: ActivityLayer;
  fee?: number;
  account?: string;
  network?: string;
  paymentHash?: string;
  kind?: string;
  /** KaleidoPay/Electrum swap attempt behind this item. */
  swapAttemptId?: string;
}

export interface AssetMeta {
  asset_id: string;
  ticker: string;
  name: string;
  precision: number;
  /** Owning protocol. Spark/Arkade tokens must NOT be queried via the RGB adapter. */
  protocol?: 'RGB' | 'SPARK' | 'ARKADE';
}

export interface SwapActivityInput {
  rfq_id: string;
  status: 'completed' | 'pending' | 'failed' | 'whitelisted' | 'executing';
  created_at: number;
  txid?: string;
  from_asset?: string;
  to_asset?: string;
  from_amount?: number;
  to_amount?: number;
  venue?: 'kaleidoswap' | 'flashnet';
}

/** An Electrum swap that paid an on-chain address (see services/kaleidoPay/activity.ts). */
export interface SwapAttemptActivityInput {
  id: string;
  failed: boolean;
  network: string;
  /** Sats the destination receives. */
  amountSat: number;
  /** Claim fee, once the claim is built. */
  fee?: number;
  /** Claim txid, or the provider's lockup before the claim exists. */
  txid?: string;
  confirmed: boolean;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure, side-effect free)
// ---------------------------------------------------------------------------

export function formatSatsFromMsat(amtMsat: number): string {
  return Math.floor(amtMsat / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatAssetAmount(amount: number, precision: number): string {
  const value = amount / Math.pow(10, precision);
  return value.toLocaleString('en-US', {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  });
}

function normalizePaymentStatus(status?: string): ActivityStatus {
  const s = (status || '').toLowerCase();
  if (s === 'confirmed' || s === 'succeeded' || s === 'success' || s === 'settled' || s === 'completed') return 'confirmed';
  if (s === 'failed' || s === 'error' || s === 'expired') return 'failed';
  if (['pending', 'in_flight', 'processing', 'broadcast', 'unconfirmed', 'initiated'].includes(s)) return 'pending';
  return 'unknown';
}

function normalizeProtocolTransactionStatus(
  proto: 'SPARK' | 'ARKADE' | 'BARK',
  tx: any,
): ActivityStatus {
  const status = normalizePaymentStatus(tx?.status);
  if (status === 'confirmed' || status === 'failed') return status;

  const raw = tx?.protocolData ?? tx ?? {};
  if (proto === 'SPARK' && tx?.type === 'receive') {
    const rawType = String(raw.type ?? raw.transferType ?? raw.sparkTransactionType ?? '').toUpperCase();
    const hasUserRequest = raw.userRequest != null || raw.userRequestId != null;
    const hasTransferShape =
      raw.receiverIdentityPublicKey != null ||
      raw.senderIdentityPublicKey != null ||
      raw.totalValue != null;

    // Direct Spark transfers are spendable as Spark balance even when the raw SDK
    // transfer status is still an intermediate key-tweak state. Lightning/on-chain
    // receives carry a userRequest and should keep their actual pending state.
    if (rawType === 'TRANSFER' || rawType === '2' || (!hasUserRequest && hasTransferShape)) {
      return 'confirmed';
    }
  }

  if (proto === 'ARKADE' && tx?.type === 'receive') {
    const key = raw.key ?? {};
    if (raw.settled || !key.boardingTxid) return 'confirmed';
  }

  return status;
}

function normalizeTransferStatus(status?: string): ActivityStatus {
  const s = (status || '').toLowerCase();
  if (s === 'settled' || s === 'confirmed') return 'confirmed';
  if (s === 'failed') return 'failed';
  return 'pending';
}

function normalizeSwapStatus(status?: string): ActivityStatus {
  const s = (status || '').toLowerCase();
  if (s === 'completed' || s === 'success') return 'confirmed';
  if (s === 'failed' || s === 'error') return 'failed';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export interface LoadActivityOptions {
  assets?: AssetMeta[];
  swaps?: SwapActivityInput[];
  swapAttempts?: SwapAttemptActivityInput[];
}

export interface ActivityResult {
  items: ActivityItem[];
  /** Number of sources that failed to load (for surfacing a soft error). */
  failedSources: number;
  hadConnectedAdapter: boolean;
}

/**
 * Build a unified, newest-first activity feed from all connected protocols
 * plus the supplied swap history.
 */
export async function loadActivity(opts: LoadActivityOptions = {}): Promise<ActivityResult> {
  const { assets = [], swaps = [], swapAttempts = [] } = opts;
  const items: ActivityItem[] = [];
  let failedSources = 0;
  let hadConnectedAdapter = false;

  const assetMap: Record<string, AssetMeta> = {};
  for (const a of assets) assetMap[a.asset_id] = a;

  const rgb = rgbAccountAdapter(); // the node, or RGB on this phone
  const rgbConnected = !!rgb?.isConnected();

  // 1. Lightning payments (BTC LN + RGB LN)
  if (rgbConnected) {
    hadConnectedAdapter = true;
    try {
      const res: any = await (rgb as any).listPayments();
      const payments: any[] = res?.payments || res || [];
      for (const p of payments) {
        const isRgb = !!p.asset_id;
        const meta = p.asset_id ? assetMap[p.asset_id] : undefined;

        let amount: string;
        let assetTicker: string;
        let assetPrecision: number;
        if (isRgb && meta) {
          amount = formatAssetAmount(p.asset_amount ?? 0, meta.precision);
          assetTicker = meta.ticker;
          assetPrecision = meta.precision;
        } else if (isRgb) {
          amount = String(p.asset_amount ?? 0);
          assetTicker = 'asset';
          assetPrecision = 0;
        } else {
          amount = formatSatsFromMsat(p.amt_msat ?? 0);
          assetTicker = 'sats';
          assetPrecision = 0;
        }

        items.push({
          id: `payment-${p.payment_hash || items.length}`,
          type: p.inbound ? 'receive' : 'send',
          source: 'payment',
          asset: p.asset_id || 'BTC',
          assetName: meta?.name ?? (isRgb ? 'Asset' : 'Bitcoin'),
          assetTicker,
          assetPrecision,
          amount,
          rawSats: !isRgb ? Math.floor((p.amt_msat ?? 0) / 1000) : undefined,
          status: normalizePaymentStatus(p.status),
          timestamp: p.created_at ? p.created_at * 1000 : undefined,
          txid: p.payment_hash || '',
          layer: isRgb ? 'RGB-LN' : 'LN',
          paymentHash: p.payment_hash,
          account: 'RGB',
          fee: typeof p.fee_msat === 'number' ? p.fee_msat / 1000 : undefined,
        });
      }
    } catch (err) {
      console.warn('ActivityService: failed to load payments', err);
      failedSources++;
    }
  }

  // 2. RGB on-chain transfers — one call per known RGB asset.
  // Spark/Arkade tokens live in the same asset list but must never be queried
  // through the RGB adapter (their txs come from listTransactions in step 3).
  if (rgbConnected) {
    for (const meta of assets) {
      if (meta.protocol && meta.protocol !== 'RGB') continue;
      try {
        const res: any = await (rgb as any).listTransfers({ asset_id: meta.asset_id });
        const transfers: any[] = res?.transfers || res || [];
        for (const t of transfers) {
          const kind: string = t.kind || 'Send';
          let type: ActivityItemType = 'send';
          if (kind === 'ReceiveBlind' || kind === 'ReceiveWitness' || kind.includes('Receive')) type = 'receive';
          else if (kind === 'Issuance' || kind === 'Inflation') type = 'issuance';

          const rawAmount = t.requested_assignment?.value ?? t.amount ?? 0;
          items.push({
            id: `transfer-${t.txid || items.length}-${t.idx ?? 0}`,
            type,
            source: 'transfer',
            asset: meta.asset_id,
            assetName: meta.name,
            assetTicker: meta.ticker,
            assetPrecision: meta.precision,
            amount: formatAssetAmount(rawAmount, meta.precision),
            status: normalizeTransferStatus(t.status),
            timestamp: t.created_at ? t.created_at * 1000 : undefined,
            txid: t.txid || '',
            layer: 'RGB-L1',
            kind: t.kind,
          });
        }
      } catch (err) {
        // Per-asset failure is non-fatal; keep going.
        console.warn(`ActivityService: failed to load transfers for ${meta.ticker}`, err);
      }
    }
  }

  // 3. Spark / Arkade unified transactions
  for (const proto of ['SPARK', 'ARKADE', 'BARK'] as const) {
    const adapter = protocolManager.getAdapterIfAvailable(proto);
    if (!adapter?.isConnected()) continue;
    hadConnectedAdapter = true;
    try {
      // Missing connection metadata must not hide otherwise readable history.
      const info = await adapter.getConnectionInfo?.().catch(() => null);
      const network = info?.network;
      const txs = await adapter.listTransactions({ limit: 50 });
      for (const tx of txs) {
        if (tx.type !== 'send' && tx.type !== 'receive') continue;
        const ticker = tx.asset?.ticker;
        const isBtc = !ticker || ticker === 'BTC';
        const precision = tx.asset?.precision ?? 0;
        items.push({
          id: `${proto.toLowerCase()}-${tx.id}`,
          type: tx.type,
          source: 'payment',
          asset: tx.asset?.id ?? 'BTC',
          assetName: tx.asset?.name,
          assetTicker: isBtc ? 'sats' : ticker!,
          assetPrecision: precision,
          amount: !isBtc && precision > 0 ? formatAssetAmount(tx.amount, precision) : formatSats(tx.amount),
          rawSats: isBtc ? tx.amount : undefined,
          status: normalizeProtocolTransactionStatus(proto, tx),
          timestamp: tx.timestamp,
          txid: tx.id,
          layer: proto === 'BARK' ? (network === 'signet' ? 'Bark Signet' : 'Bark') : proto === 'SPARK' ? 'Spark' : 'Arkade',
          fee: tx.fee,
          account: proto,
          network,
        });
      }
    } catch (err) {
      console.warn(`ActivityService: failed to load ${proto} transactions`, err);
      failedSources++;
    }
  }

  // 4. Swaps (KaleidoSwap atomic + Flashnet AMM) from Redux history
  for (const swap of swaps) {
    const trimNum = (n: number) => parseFloat(n.toFixed(8)).toString();
    // BTC swap legs are stored in satoshis — label them "sats", not "BTC", so a
    // 801-sat leg reads "801 sats" instead of the misleading "801 BTC".
    const legTicker = (asset?: string | null) => (asset === 'BTC' ? 'sats' : asset || '');
    const fmtLeg = (amt: number, asset?: string | null) => `${trimNum(amt)} ${legTicker(asset)}`.trim();
    const hasLegs =
      swap.from_asset != null && swap.to_asset != null &&
      swap.from_amount != null && swap.to_amount != null;
    const venueName = swap.venue === 'flashnet' ? 'Flashnet Swap' : 'Atomic Swap';
    items.push({
      id: `swap-${swap.rfq_id}`,
      type: 'swap',
      source: 'swap',
      asset: swap.to_asset || 'BTC',
      // Full route lives in the subtitle (assetName); the right-hand column shows
      // only the *received* leg, so the ticker is no longer duplicated.
      assetName: hasLegs
        ? `${fmtLeg(swap.from_amount as number, swap.from_asset)} → ${fmtLeg(swap.to_amount as number, swap.to_asset)}`
        : venueName,
      assetTicker: hasLegs ? legTicker(swap.to_asset) : '',
      assetPrecision: 0,
      amount: hasLegs ? trimNum(swap.to_amount as number) : '',
      status: normalizeSwapStatus(swap.status),
      timestamp: swap.created_at,
      txid: swap.txid || swap.rfq_id,
      layer: 'Swap',
    });
  }

  // 5. Electrum swap payments: Lightning in, on-chain out to the requested address
  for (const a of swapAttempts) {
    items.push({
      id: `electrum-${a.id}`,
      type: 'send',
      source: 'onchain',
      asset: 'BTC',
      assetName: 'Electrum swap',
      assetTicker: 'sats',
      assetPrecision: 0,
      amount: a.amountSat.toLocaleString('en-US'),
      rawSats: a.amountSat,
      status: a.failed ? 'failed' : a.confirmed ? 'confirmed' : 'pending',
      timestamp: a.updatedAt,
      txid: a.txid ?? '',
      layer: 'L1',
      fee: a.fee,
      network: a.network,
      swapAttemptId: a.id,
    });
  }

  // Newest first; undated items sink to the bottom.
  items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  return { items, failedSources, hadConnectedAdapter };
}
