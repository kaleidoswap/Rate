/**
 * The RGB account's on-chain wallet calls: transfers (refresh, list, find, cancel),
 * UTXOs, issuance and fee rates, over whichever backing is the RGB account.
 * RGB on this phone serializes its own calls (services/protocols/rgbLibRn.ts),
 * so nothing here runs two of them at once; loops below still go one by one.
 */
import { MempoolClient } from './mempool/MempoolClient';
import { mempoolNetworkFor } from '../utils/explorer';
import {
  findRgbTransfer, normalizeRgbTransfers, rgbWalletSupport,
  type RgbIssueRequest, type RgbTransfer,
} from '../utils/rgb-wallet';

interface DeviceAccount {
  refreshTransfers?: () => Promise<boolean>;
  listTransfers?: (assetId: string | null) => Promise<unknown>;
  failTransfer?: (batchTransferIdx: number) => Promise<boolean>;
  issueAssetCfa?: (params: { name: string; details?: string | null; precision: number; amounts: number[] }) => Promise<any>;
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

/** Fails a transfer still waiting for its counterparty (RGB on this phone). */
export async function cancelRgbTransfer(adapter: any, batchTransferIdx: number): Promise<boolean> {
  const device = deviceAccount(adapter);
  if (!device?.failTransfer) throw new Error('Cancelling transfers is not supported by this RGB account.');
  return device.failTransfer(batchTransferIdx);
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
  if (request.schema === 'CFA') {
    const issued = await deviceAccount(adapter)!.issueAssetCfa!({
      name: request.name, details: request.details ?? null, precision: request.precision, amounts: request.amounts,
    });
    if (!issued?.assetId) throw new Error('Issuance returned no asset id: no colorable UTXO');
    return { assetId: issued.assetId, name: issued.name ?? request.name, ticker: issued.name ?? request.name, precision: request.precision, supply };
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
