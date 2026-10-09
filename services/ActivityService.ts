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
//      On-chain BTC of the RGB account's wallet — RGB adapter `listTransactions()`
//      (the HTTP node adapter and RGB on this phone; NWC has no on-chain list)
//   3. Spark / Arkade unified transactions   — adapter `listTransactions()`
//   4. KaleidoSwap atomic swaps              — provided from Redux swap history
//   5. Electrum swap payments (on-chain)     — provided from KaleidoPay attempts
//   6. Cross-chain orders (bridge deposits, sends to other chains) — kept per wallet
//
// Every source is fetched on its own, with a timeout: a slow or failing one
// never blocks the rest (see streamActivity).

import { protocolManager, rgbAccountAdapter } from './protocols';
import { loadCrossChainHistory, refreshCrossChainHistory } from './crosschainHistory';
import {
  activityStatusOf,
  formatRecordAmount,
  type CrossChainRecord,
} from '../utils/crosschain-history';
import { chainLabel } from '../utils/orchestra-ui';
import { isPreimage } from '../utils/payment-proofs';

export type ActivityLayer = 'L1' | 'RGB-L1' | 'LN' | 'RGB-LN' | 'Spark' | 'Arkade' | 'Bark' | 'Bark Signet' | 'Swap' | 'Cross-chain';

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
  source: 'payment' | 'onchain' | 'transfer' | 'swap' | 'crosschain';
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
  /** Lightning proof of payment, when the account's history carries it. */
  preimage?: string;
  /** The account's own id for the payment request (Spark), for matching a saved proof. */
  requestId?: string;
  /** Bridge deposit or send to another chain. */
  crossChain?: CrossChainRecord;
}

/** A valid preimage from an account's record, lowercased. */
function preimageOf(...values: unknown[]): string | undefined {
  const found = values.find(isPreimage);
  return found ? found.toLowerCase() : undefined;
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

/**
 * On-chain BTC transactions of the RGB account's wallet (node or this phone),
 * skipping txids another source already lists (RGB transfers, swap payouts).
 */
export function onchainBtcItems(txs: any[], network: string | undefined, listed: Set<string>): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const tx of txs) {
    if (tx?.asset?.layer !== 'BTC_L1' || !tx.id || listed.has(tx.id)) continue;
    const raw: any = tx.protocolData ?? {};
    const fee = Number(raw.fee) > 0 ? Number(raw.fee) : undefined;
    const net = Number(tx.amount) || 0;
    // A send's net change includes its fee; show what was sent, the fee apart.
    const sats = tx.type === 'send' && fee != null && fee < net ? net - fee : net;
    out.push({
      id: `onchain-${tx.id}`,
      type: tx.type === 'send' ? 'send' : 'receive',
      source: 'onchain',
      asset: 'BTC',
      assetName: 'Bitcoin',
      assetTicker: 'sats',
      assetPrecision: 0,
      amount: formatSats(sats),
      rawSats: sats,
      status: tx.status === 'confirmed' ? 'confirmed' : 'pending',
      timestamp: tx.timestamp || undefined,
      txid: tx.id,
      layer: 'L1',
      fee,
      account: 'RGB',
      network,
      kind: raw.transaction_type ?? raw.transactionType,
    });
  }
  return out;
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
  /** Fetched as its own source, in place of `swapAttempts`. */
  loadSwapAttempts?: () => Promise<SwapAttemptActivityInput[]>;
  /** Active wallet, for its cross-chain orders. */
  walletId?: number | null;
  /** Per-source limit; a source that takes longer keeps its last items. */
  timeoutMs?: number;
  /** Start from this wallet's last list and keep it for the next load. */
  useCache?: boolean;
}

export interface ActivityResult {
  items: ActivityItem[];
  /** Number of sources that failed to load (for surfacing a soft error). */
  failedSources: number;
  hadConnectedAdapter: boolean;
}

export interface ActivityProgress extends ActivityResult {
  /** Sources still loading. */
  pending: number;
}

type ActivitySource =
  | 'payments' | 'transfers' | 'SPARK' | 'ARKADE' | 'BARK'
  | 'swaps' | 'swapAttempts' | 'crosschain' | 'onchain';

export type ActivityParts = Partial<Record<ActivitySource, ActivityItem[]>>;

const MERGE_ORDER: ActivitySource[] = ['payments', 'transfers', 'SPARK', 'ARKADE', 'BARK', 'swaps', 'swapAttempts', 'crosschain'];

export const ACTIVITY_SOURCE_TIMEOUT_MS = 20_000;

/**
 * One newest-first list from each source's items. The RGB account's on-chain
 * BTC goes last, so a txid another source already lists is not shown twice.
 */
export function mergeActivity(parts: ActivityParts): ActivityItem[] {
  const items = MERGE_ORDER.flatMap((source) => parts[source] ?? []);
  const listed = new Set(items.map((i) => i.txid).filter(Boolean));
  items.push(...(parts.onchain ?? []).filter((i) => !listed.has(i.txid)));
  // Newest first; undated items sink to the bottom.
  items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return items;
}

const lastParts = new Map<string, ActivityParts>();
const inFlight = new Map<string, { call: Promise<ActivityItem[]>; startedAt: number }>();

/** Forget the cached lists and running calls. */
export function clearActivityCache(): void {
  lastParts.clear();
  inFlight.clear();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function paymentItems(payments: any[], assetMap: Record<string, AssetMeta>): ActivityItem[] {
  const items: ActivityItem[] = [];
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
      preimage: p.inbound ? undefined : preimageOf(p.preimage, p.payment_preimage),
      account: 'RGB',
      fee: typeof p.fee_msat === 'number' ? p.fee_msat / 1000 : undefined,
    });
  }
  return items;
}

function transferItems(transfers: any[], meta: AssetMeta, network: string | undefined, offset: number): ActivityItem[] {
  return transfers.map((t, i) => {
    const kind: string = t.kind || 'Send';
    let type: ActivityItemType = 'send';
    if (kind === 'ReceiveBlind' || kind === 'ReceiveWitness' || kind.includes('Receive')) type = 'receive';
    else if (kind === 'Issuance' || kind === 'Inflation') type = 'issuance';

    const rawAmount = t.requested_assignment?.value ?? t.amount ?? 0;
    return {
      id: `transfer-${t.txid || offset + i}-${t.idx ?? 0}`,
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
      network,
    };
  });
}

function protocolItems(proto: 'SPARK' | 'ARKADE' | 'BARK', txs: any[], network: string | undefined): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const tx of txs) {
    if (tx.type !== 'send' && tx.type !== 'receive') continue;
    const ticker = tx.asset?.ticker;
    const isBtc = !ticker || ticker === 'BTC';
    const precision = tx.asset?.precision ?? 0;
    const raw: any = (tx as any).protocolData ?? {};
    const request: any = typeof raw.userRequest === 'object' && raw.userRequest ? raw.userRequest : {};
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
      paymentHash: typeof request.paymentHash === 'string' ? request.paymentHash : undefined,
      preimage: tx.type === 'send'
        ? preimageOf((tx as any).preimage, request.paymentPreimage, raw.preimage)
        : undefined,
      requestId: typeof request.id === 'string' ? request.id : undefined,
    });
  }
  return items;
}

function swapItems(swaps: SwapActivityInput[]): ActivityItem[] {
  const trimNum = (n: number) => parseFloat(n.toFixed(8)).toString();
  // BTC swap legs are stored in satoshis — label them "sats", not "BTC", so a
  // 801-sat leg reads "801 sats" instead of the misleading "801 BTC".
  const legTicker = (asset?: string | null) => (asset === 'BTC' ? 'sats' : asset || '');
  const fmtLeg = (amt: number, asset?: string | null) => `${trimNum(amt)} ${legTicker(asset)}`.trim();
  return swaps.map((swap) => {
    const hasLegs =
      swap.from_asset != null && swap.to_asset != null &&
      swap.from_amount != null && swap.to_amount != null;
    const venueName = swap.venue === 'flashnet' ? 'Flashnet Swap' : 'Atomic Swap';
    return {
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
    };
  });
}

/** Electrum swap payments: Lightning in, on-chain out to the requested address. */
function swapAttemptItems(swapAttempts: SwapAttemptActivityInput[]): ActivityItem[] {
  return swapAttempts.map((a) => ({
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
  }));
}

function crossChainItems(records: CrossChainRecord[]): ActivityItem[] {
  return records.map((rec) => {
    const deposit = rec.direction === 'deposit';
    const external = deposit ? rec.sourceChain : rec.destChain;
    const shown = deposit
      ? formatRecordAmount(rec.amountOutRaw, rec.destDecimals, rec.destAsset)
      : formatRecordAmount(rec.amountInRaw, rec.sourceDecimals, rec.sourceAsset);
    const [amount, ...tickerParts] = shown.split(' ');
    const shownAsset = (deposit ? rec.destAsset : rec.sourceAsset).toUpperCase();
    const shownRaw = deposit ? rec.amountOutRaw : rec.amountInRaw;
    return {
      id: `crosschain-${rec.id}`,
      type: deposit ? 'receive' : 'send',
      source: 'crosschain',
      asset: deposit ? rec.destAsset : rec.sourceAsset,
      assetName: deposit
        ? `From ${rec.sourceAsset} on ${chainLabel(external)}`
        : `To ${rec.destAsset} on ${chainLabel(external)}`,
      assetTicker: tickerParts.join(' '),
      assetPrecision: 0,
      amount: amount ?? '',
      rawSats: shownAsset === 'BTC' && shownRaw ? Number(shownRaw) : undefined,
      status: activityStatusOf(rec),
      timestamp: rec.createdAt,
      txid: rec.orderId ?? rec.id,
      layer: 'Cross-chain',
      account: 'SPARK',
      network: chainLabel(external),
      crossChain: rec,
    };
  });
}

interface SourceTask {
  source: ActivitySource;
  load: () => Promise<ActivityItem[]>;
  /** Counted in `failedSources` when it fails or times out. */
  counted: boolean;
  label: string;
}

/**
 * Load every source independently and report the merged list each time one
 * lands. A source that fails or times out keeps its last items (with
 * `useCache`) and never holds up the others. `cancel` stops further updates.
 */
export function streamActivity(
  opts: LoadActivityOptions = {},
  onUpdate?: (progress: ActivityProgress) => void,
): { done: Promise<ActivityProgress>; cancel: () => void } {
  const {
    assets = [], swaps = [], swapAttempts = [], loadSwapAttempts, walletId,
    timeoutMs = ACTIVITY_SOURCE_TIMEOUT_MS, useCache = false,
  } = opts;
  const cacheKey = String(walletId ?? '');
  const parts: ActivityParts = useCache ? { ...lastParts.get(cacheKey) } : {};
  const tasks: SourceTask[] = [];
  let failedSources = 0;
  let hadConnectedAdapter = false;
  let cancelled = false;

  const assetMap: Record<string, AssetMeta> = {};
  for (const a of assets) assetMap[a.asset_id] = a;

  const rgb: any = rgbAccountAdapter(); // the node, or RGB on this phone
  const rgbConnected = !!rgb?.isConnected();
  // Over NWC, list_transactions is Lightning invoices: the node's on-chain list
  // would need an rln_list_transactions method.
  const overNwc = typeof rgb?.walletType === 'function';
  let networkLookup: Promise<string | undefined> | undefined;
  const rgbNetwork = () => (networkLookup ??= new Promise<any>((resolve) => resolve(rgb.getConnectionInfo?.()))
    .then((info) => info?.network, () => undefined));

  if (rgbConnected) {
    hadConnectedAdapter = true;
    tasks.push({
      source: 'payments',
      counted: true,
      label: 'payments',
      load: async () => {
        const res: any = await rgb.listPayments();
        return paymentItems(res?.payments || res || [], assetMap);
      },
    });
    // Spark/Arkade tokens live in the same asset list but must never be queried
    // through the RGB adapter (their txs come from their own account).
    const rgbAssets = assets.filter((meta) => !meta.protocol || meta.protocol === 'RGB');
    tasks.push({
      source: 'transfers',
      counted: false,
      label: 'RGB transfers',
      load: async () => {
        const network = await rgbNetwork();
        const perAsset = await Promise.all(rgbAssets.map(async (meta) => {
          try {
            const res: any = await rgb.listTransfers({ asset_id: meta.asset_id });
            return { meta, transfers: (res?.transfers || res || []) as any[] };
          } catch (err) {
            // Per-asset failure is non-fatal; keep going.
            console.warn(`ActivityService: failed to load transfers for ${meta.ticker}`, err);
            return { meta, transfers: [] };
          }
        }));
        const items: ActivityItem[] = [];
        for (const { meta, transfers } of perAsset) items.push(...transferItems(transfers, meta, network, items.length));
        return items;
      },
    });
    if (!overNwc && typeof rgb.listTransactions === 'function') {
      tasks.push({
        source: 'onchain',
        counted: true,
        label: 'on-chain BTC transactions',
        load: async () => {
          const [txs, network] = await Promise.all([rgb.listTransactions(), rgbNetwork()]);
          return onchainBtcItems(txs, network, new Set());
        },
      });
    } else {
      parts.onchain = [];
    }
  } else {
    parts.payments = [];
    parts.transfers = [];
    parts.onchain = [];
  }

  for (const proto of ['SPARK', 'ARKADE', 'BARK'] as const) {
    const adapter = protocolManager.getAdapterIfAvailable(proto);
    if (!adapter?.isConnected()) {
      parts[proto] = [];
      continue;
    }
    hadConnectedAdapter = true;
    tasks.push({
      source: proto,
      counted: true,
      label: `${proto} transactions`,
      load: async () => {
        // Missing connection metadata must not hide otherwise readable history.
        const info = await adapter.getConnectionInfo?.().catch(() => null);
        return protocolItems(proto, await adapter.listTransactions({ limit: 50 }), info?.network);
      },
    });
  }

  parts.swaps = swapItems(swaps);

  if (loadSwapAttempts) {
    tasks.push({
      source: 'swapAttempts',
      counted: false,
      label: 'swap payments',
      load: async () => swapAttemptItems(await loadSwapAttempts()),
    });
  } else {
    parts.swapAttempts = swapAttemptItems(swapAttempts);
  }

  if (walletId != null) {
    tasks.push({
      source: 'crosschain',
      counted: false,
      label: 'cross-chain orders',
      load: async () => {
        // Statuses refresh in the background; the next load shows them.
        void refreshCrossChainHistory(walletId).catch(() => {});
        return crossChainItems(await loadCrossChainHistory(walletId));
      },
    });
  } else {
    parts.crosschain = [];
  }

  let pending = tasks.length;
  const progress = (): ActivityProgress => ({ items: mergeActivity(parts), failedSources, hadConnectedAdapter, pending });
  const report = () => {
    if (cancelled) return;
    if (useCache) lastParts.set(cacheKey, { ...parts });
    onUpdate?.(progress());
  };

  if (tasks.length > 0) onUpdate?.(progress());

  const done = Promise.all(tasks.map(async (task) => {
    // A slow call still running from a recent load is awaited, not repeated;
    // one that looks stuck is retried.
    const flightKey = `${cacheKey}:${task.source}`;
    let flight = inFlight.get(flightKey);
    if (!flight || Date.now() - flight.startedAt > timeoutMs * 3) {
      const entry = { call: task.load(), startedAt: Date.now() };
      inFlight.set(flightKey, entry);
      const clear = () => { if (inFlight.get(flightKey) === entry) inFlight.delete(flightKey); };
      entry.call.then(clear, clear);
      flight = entry;
    }
    const { call } = flight;
    try {
      parts[task.source] = await withTimeout(call, timeoutMs);
    } catch (err) {
      console.warn(`ActivityService: failed to load ${task.label}`, err);
      if (task.counted) failedSources++;
    }
    pending--;
    report();
  })).then(progress);

  return { done, cancel: () => { cancelled = true; } };
}

/**
 * Build a unified, newest-first activity feed from all connected protocols
 * plus the supplied swap history.
 */
export function loadActivity(opts: LoadActivityOptions = {}): Promise<ActivityResult> {
  return streamActivity(opts).done.then(({ pending: _pending, ...result }) => result);
}
