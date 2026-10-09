import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppSelector } from '../store/hooks';
import { selectDisclosureLevel } from '../store/slices/settingsSlice';
import { useAssetInventory } from './useAssetInventory';
import { useFiatRates } from './useFiatRates';
import { inventoryBtc, inventoryTokens } from '../utils/asset-inventory';
import { snapshotWalletKey } from '../services/balanceSnapshot';
import { loadActivity, type ActivityItem, type AssetMeta } from '../services/ActivityService';
import { MempoolClient } from '../services/mempool/MempoolClient';
import { mempoolNetworkFor } from '../utils/explorer';
import { rgbAccountAdapter, rgbAccountIsOnDevice } from '../services/protocols';
import { onRgbBackupStatus, rgbBackupStatus, runRgbBackup, type RgbBackupStatus } from '../services/protocols/rgbBackup';
import {
  computeInsights, dismissInsight, loadDismissals, visibleInsights,
  type Dismissals, type Insight, type InsightChannel, type InsightInput,
} from '../services/insights';

const FEE_CHECK_MS = 30 * 60_000;
const ACTIVITY_CHECK_MS = 5 * 60_000;
let lastFees: { at: number; rates: InsightInput['feeRates'] } | null = null;
let lastActivity: { at: number; walletKey: string | null; items: ActivityItem[] } | null = null;

async function mainnetFeeRates(): Promise<InsightInput['feeRates']> {
  if (lastFees && Date.now() - lastFees.at < FEE_CHECK_MS) return lastFees.rates;
  let rates: InsightInput['feeRates'] = null;
  try {
    const info = await rgbAccountAdapter()?.getConnectionInfo?.();
    if (mempoolNetworkFor(info?.network, true) === 'mainnet') rates = await new MempoolClient('mainnet').getFeeRates();
  } catch { rates = null; }
  lastFees = { at: Date.now(), rates };
  return rates;
}

/** Raw channels (the Dashboard's list) → what the rules need. */
export function toInsightChannels(channels: any[], tickerOf: (assetId: string) => string | undefined): InsightChannel[] {
  return (channels ?? []).filter((c) => c?.asset_id).map((c) => ({
    assetTicker: tickerOf(c.asset_id),
    localUnits: Number(c.asset_local_amount) || 0,
    remoteUnits: Number(c.asset_remote_amount) || 0,
    usable: !!(c.is_usable ?? c.ready),
  }));
}

/** The Dashboard's insight cards, with per-wallet dismissals. */
export function useInsights(channels: any[] = []) {
  const wallet = useAppSelector((s) => s.wallet.activeWallet);
  const walletKey = snapshotWalletKey(wallet);
  const advanced = useAppSelector(selectDisclosureLevel) !== 'lite';
  const rgbAssets = useAppSelector((s) => s.assets.rgbAssets);
  const inventory = useAssetInventory();
  const rates = useFiatRates(['USD']);
  const [dismissed, setDismissed] = useState<Dismissals>({});
  const [feeRates, setFeeRates] = useState<InsightInput['feeRates']>(lastFees?.rates ?? null);
  const [activity, setActivity] = useState<ActivityItem[]>(lastActivity?.walletKey === walletKey ? lastActivity.items : []);
  const [backup, setBackup] = useState<RgbBackupStatus>(rgbBackupStatus());

  useEffect(() => onRgbBackupStatus(setBackup), []);
  useEffect(() => {
    let live = true;
    loadDismissals(walletKey).then((d) => { if (live) setDismissed(d); });
    mainnetFeeRates().then((r) => { if (live) setFeeRates(r); });
    if (!lastActivity || lastActivity.walletKey !== walletKey || Date.now() - lastActivity.at > ACTIVITY_CHECK_MS) {
      const assets: AssetMeta[] = (rgbAssets ?? []).map((a: any) => ({ asset_id: a.asset_id, ticker: a.ticker, name: a.name, precision: a.precision ?? 0, protocol: a.protocol }));
      loadActivity({ assets, walletId: wallet?.id, useCache: true })
        .then((r) => { lastActivity = { at: Date.now(), walletKey, items: r.items }; if (live) setActivity(r.items); })
        .catch(() => {});
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKey]);

  const insights = useMemo<Insight[]>(() => {
    const btc = inventoryBtc(inventory);
    const tickers = new Map((rgbAssets ?? []).map((a: any) => [a.asset_id, a.ticker]));
    const all = computeInsights({
      now: Date.now(),
      advanced,
      feeRates,
      onchainSat: btc.networks?.onchain ?? 0,
      rgbOnDevice: rgbAccountIsOnDevice(),
      rgbAssetsWithBalance: inventoryTokens(inventory).filter((t) => t.protocol === 'RGB' && t.balance > 0).length,
      rgbBackup: backup,
      channels: toInsightChannels(channels, (id) => tickers.get(id)),
      activity,
      btcPriceUsd: rates.usd,
    });
    return visibleInsights(all, dismissed, Date.now());
  }, [inventory, rgbAssets, advanced, feeRates, backup, channels, activity, rates.usd, dismissed]);

  const dismiss = useCallback(async (key: string) => {
    setDismissed((d) => ({ ...d, [key]: Date.now() }));
    setDismissed(await dismissInsight(walletKey, key));
  }, [walletKey]);

  const backupNow = useCallback(() => runRgbBackup(true), []);

  return { insights, dismiss, backupNow };
}
