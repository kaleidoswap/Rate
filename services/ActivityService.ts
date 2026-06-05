// services/ActivityService.ts
//
// Aggregates wallet activity across every available source into a single,
// timestamp-sorted list of {@link ActivityItem}. This is the React Native
// counterpart of the browser extension's `use-activity-data` hook, but it
// pulls from the shared `@kaleidorg/wallet-protocols` ProtocolManager adapters
// instead of the extension's background API.
//
// Sources, in priority order:
//   1. Lightning payments (BTC LN + RGB LN) — RGB adapter `listPayments()`
//   2. RGB on-chain transfers (per asset)   — RGB adapter `listTransfers()`
//   3. Spark / Arkade unified transactions   — adapter `listTransactions()`
//   4. KaleidoSwap atomic swaps              — provided from Redux swap history
//
// Every source is fetched defensively: a failure in one never blocks the rest.

import { protocolManager } from './protocols';

export type ActivityLayer = 'L1' | 'RGB-L1' | 'LN' | 'RGB-LN' | 'Spark' | 'Arkade' | 'Swap';

export type ActivityItemType =
  | 'send'
  | 'receive'
  | 'swap'
  | 'channel_open'
  | 'channel_close'
  | 'issuance';

export type ActivityStatus = 'confirmed' | 'pending' | 'failed';

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
  paymentHash?: string;
  kind?: string;
}

export interface AssetMeta {
  asset_id: string;
  ticker: string;
  name: string;
  precision: number;
}

export interface SwapActivityInput {
  rfq_id: string;
  status: 'completed' | 'pending' | 'failed' | 'whitelisted' | 'executing';
  created_at: number;
  txid?: string;
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
  if (s === 'succeeded' || s === 'success' || s === 'settled' || s === 'completed') return 'confirmed';
  if (s === 'failed' || s === 'error' || s === 'expired') return 'failed';
  return 'pending';
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
  const { assets = [], swaps = [] } = opts;
  const items: ActivityItem[] = [];
  let failedSources = 0;
  let hadConnectedAdapter = false;

  const assetMap: Record<string, AssetMeta> = {};
  for (const a of assets) assetMap[a.asset_id] = a;

  const rgb = protocolManager.getAdapterIfAvailable('RGB');
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
        });
      }
    } catch (err) {
      console.warn('ActivityService: failed to load payments', err);
      failedSources++;
    }
  }

  // 2. RGB on-chain transfers — one call per known RGB asset
  if (rgbConnected) {
    for (const meta of assets) {
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
  for (const proto of ['SPARK', 'ARKADE'] as const) {
    const adapter = protocolManager.getAdapterIfAvailable(proto);
    if (!adapter?.isConnected()) continue;
    hadConnectedAdapter = true;
    try {
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
          status: normalizePaymentStatus(tx.status),
          timestamp: tx.timestamp,
          txid: tx.id,
          layer: proto === 'SPARK' ? 'Spark' : 'Arkade',
        });
      }
    } catch (err) {
      console.warn(`ActivityService: failed to load ${proto} transactions`, err);
      failedSources++;
    }
  }

  // 4. KaleidoSwap atomic swaps (from Redux history)
  for (const swap of swaps) {
    items.push({
      id: `swap-${swap.rfq_id}`,
      type: 'swap',
      source: 'swap',
      asset: 'BTC',
      assetName: 'Atomic Swap',
      assetTicker: '',
      assetPrecision: 0,
      amount: '',
      status: normalizeSwapStatus(swap.status),
      timestamp: swap.created_at,
      txid: swap.txid || swap.rfq_id,
      layer: 'Swap',
    });
  }

  // Newest first; undated items sink to the bottom.
  items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  return { items, failedSources, hadConnectedAdapter };
}
