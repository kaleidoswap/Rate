/**
 * The RGB account's on-chain wallet calls: transfers (refresh, list, find, cancel),
 * UTXOs, issuance and fee rates, over whichever backing is the RGB account.
 * RGB on this phone serializes its own calls (services/protocols/rgbLibRn.ts),
 * so nothing here runs two of them at once; loops below still go one by one.
 */
import { MempoolClient } from './mempool/MempoolClient';
import { mempoolNetworkFor } from '../utils/explorer';
import {
  findRgbTransfer, normalizeRgbAssetMetadata, normalizeRgbTransfers, rgbWalletSupport,
  type RgbAssetMetadata, type RgbIssueRequest, type RgbTransfer,
} from '../utils/rgb-wallet';

interface DeviceAccount {
  refreshTransfers?: () => Promise<boolean>;
  listTransfers?: (assetId: string | null) => Promise<unknown>;
  failTransfer?: (batchTransferIdx: number) => Promise<boolean>;
  deleteTransfer?: (batchTransferIdx: number) => Promise<boolean>;
  deleteFailedTransfers?: () => Promise<boolean>;
  issueAssetCfa?: (params: { name: string; details?: string | null; precision: number; amounts: number[]; filePath?: string | null }) => Promise<any>;
  issueAssetUda?: (params: { ticker: string; name: string; details?: string | null; precision?: number; mediaFilePath?: string | null }) => Promise<any>;
  issueAssetIfa?: (params: { ticker: string; name: string; precision: number; amounts: number[]; inflationAmounts: number[] }) => Promise<any>;
  getAssetMetadata?: (assetId: string) => Promise<unknown>;
  inflationRights?: (assetId: string) => Promise<number>;
  inflate?: (params: { assetId: string; inflationAmounts: number[]; feeRate?: number }) => Promise<{ txid?: string }>;
  drainTo?: (params: { address: string; feeRate?: number }) => Promise<string>;
}

/** A picked file's URI ('file:///…') as the local path rgb-lib reads. */
export function localFilePath(uri: string): string {
  return /^file:\/\//i.test(uri) ? decodeURI(uri.replace(/^file:\/\//i, '')) : uri;
}

/** The app's rgb-lib bridge behind RGB on this phone, or null for a node. */
function deviceAccount(adapter: any): DeviceAccount | null {
  return adapter?.protocolName === 'RGB_L1' ? (adapter.account ?? null) : null;
}

/** Ask the account to move its pending transfers forward (an incoming one only settles then). */
export async function refreshRgbTransfers(adapter: any): Promise<void> {
  const support = rgbWalletSupport(adapter);
  if (!support.refreshTransfers) return;
  const device = deviceAccount(adapter);
  if (device?.refreshTransfers) { await device.refreshTransfers(); return; }
  if (support.kind === 'nwc-node') { await adapter.refreshTransfers?.(); return; }
  await adapter.refreshBalances?.();
}

/** One asset's transfers; null (RGB on this phone only) lists receives of an asset not known yet. */
export async function listRgbTransfers(adapter: any, assetId: string | null): Promise<RgbTransfer[]> {
  if (!rgbWalletSupport(adapter).listTransfers) return [];
  if (assetId == null) {
    const device = deviceAccount(adapter);
    return device?.listTransfers ? normalizeRgbTransfers(await device.listTransfers(null)) : [];
  }
  return normalizeRgbTransfers(await adapter.listTransfers({ asset_id: assetId }));
}

/**
 * The transfer behind an invoice. Without an asset id the invoice takes any asset:
 * look among receives of unknown assets, then in each asset the account holds.
 */
export async function findRgbReceive(adapter: any, { recipientId, assetId }: { recipientId: string; assetId: string | null }): Promise<RgbTransfer | undefined> {
  if (assetId) return findRgbTransfer(await listRgbTransfers(adapter, assetId), recipientId);
  const unknown = findRgbTransfer(await listRgbTransfers(adapter, null), recipientId);
  if (unknown) return unknown;
  const assets: any[] = (await adapter.listAssets?.()) ?? [];
  for (const asset of assets) {
    if (!asset?.id || asset.id === 'BTC') continue;
    const found = findRgbTransfer(await listRgbTransfers(adapter, asset.id), recipientId);
    if (found) return found;
  }
  return undefined;
}

/** Fails a transfer still waiting for its counterparty (RGB on this phone, or the node through the engine). */
export async function cancelRgbTransfer(adapter: any, batchTransferIdx: number): Promise<boolean> {
  const device = deviceAccount(adapter);
  if (device?.failTransfer) return device.failTransfer(batchTransferIdx);
  if (rgbWalletSupport(adapter).kind === 'engine-node' && rgbWalletSupport(adapter).cancelTransfer) {
    const r: any = await adapter.executeProtocolOperation('failTransfers', { batch_transfer_idx: batchTransferIdx, no_asset_only: false, skip_sync: false });
    return r?.transfers_changed ?? r === true;
  }
  throw new Error('Cancelling transfers is not supported by this RGB account.');
}

/** Removes a failed transfer from the history (RGB on this phone). */
export async function deleteRgbTransfer(adapter: any, batchTransferIdx: number): Promise<boolean> {
  const device = deviceAccount(adapter);
  if (!rgbWalletSupport(adapter).deleteTransfer || !device?.deleteTransfer) throw new Error('Removing transfers is not supported by this RGB account.');
  return device.deleteTransfer(batchTransferIdx);
}

/** Removes every failed transfer from the history (RGB on this phone). */
export async function deleteFailedRgbTransfers(adapter: any): Promise<boolean> {
  const device = deviceAccount(adapter);
  if (!rgbWalletSupport(adapter).deleteTransfer || !device?.deleteFailedTransfers) throw new Error('Removing transfers is not supported by this RGB account.');
  return device.deleteFailedTransfers();
}

/** An asset's contract data and media, or null when the account can't read it. */
export async function getRgbAssetMetadata(adapter: any, assetId: string): Promise<RgbAssetMetadata | null> {
  const support = rgbWalletSupport(adapter);
  if (!support.metadata) return null;
  const device = deviceAccount(adapter);
  if (device?.getAssetMetadata) return normalizeRgbAssetMetadata(await device.getAssetMetadata(assetId));
  return normalizeRgbAssetMetadata(await adapter.executeProtocolOperation('getAssetMetadata', { asset_id: assetId }));
}

/** Base units of an IFA asset this wallet may still issue; 0 when it holds no rights or can't inflate. */
export async function rgbInflationRights(adapter: any, assetId: string): Promise<number> {
  const device = deviceAccount(adapter);
  if (!rgbWalletSupport(adapter).inflate || !device?.inflationRights) return 0;
  return device.inflationRights(assetId);
}

export async function inflateRgbAsset(adapter: any, params: { assetId: string; amount: number; feeRate: number }): Promise<string | undefined> {
  const device = deviceAccount(adapter);
  if (!rgbWalletSupport(adapter).inflate || !device?.inflate) throw new Error('This RGB account cannot inflate assets.');
  const result = await device.inflate({ assetId: params.assetId, inflationAmounts: [params.amount], feeRate: params.feeRate });
  return result?.txid;
}

/** Sends all plain bitcoin of RGB on this phone to `address`; outputs holding assets stay. Resolves to the txid. */
export async function drainRgbWallet(adapter: any, params: { address: string; feeRate: number }): Promise<string> {
  const device = deviceAccount(adapter);
  if (!rgbWalletSupport(adapter).drain || !device?.drainTo) throw new Error('This RGB account cannot send all its bitcoin at once.');
  return device.drainTo({ address: params.address.trim(), feeRate: params.feeRate });
}

/** The RGB account's chain ('mainnet', 'mutinynet', …), when known. */
export async function rgbAccountNetwork(adapter: any): Promise<string | undefined> {
  try {
    const info = await adapter?.getConnectionInfo?.();
    const raw = String(info?.network ?? adapter?.network ?? '').toLowerCase();
    return raw === 'bitcoin' ? 'mainnet' : raw || undefined;
  } catch {
    return undefined;
  }
}

export interface IssuedRgbAsset {
  assetId: string;
  name: string;
  ticker: string;
  precision: number;
  supply: number;
}

export async function issueRgbAsset(adapter: any, request: RgbIssueRequest): Promise<IssuedRgbAsset> {
  const support = rgbWalletSupport(adapter);
  if (!support.issue.includes(request.schema)) throw new Error(`This RGB account cannot issue ${request.schema} assets.`);
  const supply = request.amounts.reduce((sum, n) => sum + n, 0);
  const device = deviceAccount(adapter)!;
  const media = request.mediaPath && support.issueMedia ? localFilePath(request.mediaPath) : null;
  const done = (issued: any, ticker: string) => {
    if (!issued?.assetId) throw new Error('Issuance returned no asset id: no colorable UTXO');
    return { assetId: issued.assetId, name: issued.name ?? request.name, ticker, precision: request.precision, supply };
  };
  if (request.schema === 'CFA') {
    const issued = await device.issueAssetCfa!({
      name: request.name, details: request.details ?? null, precision: request.precision, amounts: request.amounts,
      ...(media ? { filePath: media } : {}),
    });
    return done(issued, issued?.name ?? request.name);
  }
  if (request.schema === 'UDA') {
    const issued = await device.issueAssetUda!({ ticker: request.ticker!, name: request.name, details: request.details ?? null, precision: 0, mediaFilePath: media });
    return done(issued, issued?.ticker ?? request.ticker!);
  }
  if (request.schema === 'IFA') {
    const issued = await device.issueAssetIfa!({
      ticker: request.ticker!, name: request.name, precision: request.precision, amounts: request.amounts, inflationAmounts: request.inflationAmounts ?? [],
    });
    return done(issued, issued?.ticker ?? request.ticker!);
  }
  const issued = await adapter.issueAssetNia({ ticker: request.ticker, name: request.name, precision: request.precision, amounts: request.amounts });
  return { assetId: issued.id, name: issued.name ?? request.name, ticker: issued.ticker ?? request.ticker ?? '', precision: request.precision, supply };
}

export async function createRgbUtxos(adapter: any, params: { num: number; size: number; feeRate: number }): Promise<void> {
  if (typeof adapter?.createRgbUtxos === 'function') {
    await adapter.createRgbUtxos({ ...params, upTo: false });
    return;
  }
  await adapter.executeProtocolOperation('createUtxos', { fee_rate: params.feeRate, num: params.num, size: params.size, skip_sync: false, up_to: false });
}

export interface RgbFeeRates {
  slow: number;
  normal: number;
  fast: number;
  /** False when the rates are the defaults because the network couldn't be asked. */
  live: boolean;
}

export const DEFAULT_RGB_FEE_RATES: RgbFeeRates = { slow: 1, normal: 2, fast: 5, live: false };

/** Whole sat/vB rates (rgb-lib takes integers) for the RGB account's network, from mempool. */
export async function rgbFeeRates(adapter: any): Promise<RgbFeeRates> {
  try {
    const info = await adapter?.getConnectionInfo?.();
    const site = mempoolNetworkFor(info?.network, true);
    if (!site) return DEFAULT_RGB_FEE_RATES;
    const r = await new MempoolClient(site).getFeeRates();
    const up = (n: unknown, floor: number) => Math.max(floor, Math.ceil(Number(n) || floor));
    const slow = up(r.hourFee, 1);
    const normal = Math.max(slow, up(r.halfHourFee, 1));
    return { slow, normal, fast: Math.max(normal, up(r.fastestFee, 1)), live: true };
  } catch {
    return DEFAULT_RGB_FEE_RATES;
  }
}
