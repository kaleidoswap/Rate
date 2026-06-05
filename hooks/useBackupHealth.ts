import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import type { AssetRecord } from '../services/DatabaseService';

export type BackupSeverity = 'ok' | 'info' | 'warning';

export interface BackupHealth {
  /** Distinct RGB assets known to the wallet. */
  rgbAssetCount: number;
  /** RGB assets currently holding a non-zero balance. */
  rgbAssetsWithBalance: number;
  /** Open Lightning channels (passed in by the caller that has them). */
  channelCount: number;
  /**
   * True when the 12-word seed alone is NOT sufficient to restore everything:
   * RGB asset state and Lightning channel state live in node-side data, not in
   * the BIP39 seed. This is the core Bitcoin-Design-Guide-vs-RGB-reality gap.
   */
  seedOnlyInsufficient: boolean;
  severity: BackupSeverity;
}

/**
 * Pure backup-risk assessment. Kept separate from the hook so it can be tested
 * without a store. Plain Bitcoin is fully seed-recoverable; RGB assets and
 * Lightning channels are not — they depend on node persistence.
 */
export function computeBackupHealth(input: {
  rgbAssets: Pick<AssetRecord, 'balance'>[];
  channelCount: number;
}): BackupHealth {
  const rgbAssets = input.rgbAssets ?? [];
  const channelCount = Math.max(0, input.channelCount ?? 0);

  const rgbAssetCount = rgbAssets.length;
  const rgbAssetsWithBalance = rgbAssets.filter((a) => (a?.balance ?? 0) > 0).length;

  const hasRgbAtRisk = rgbAssetsWithBalance > 0;
  const hasChannels = channelCount > 0;

  // Warn loudest when real RGB value would be lost on seed-only recovery; a
  // softer "info" when only channels exist; "ok" for a plain-BTC wallet.
  const severity: BackupSeverity = hasRgbAtRisk ? 'warning' : hasChannels ? 'info' : 'ok';

  return {
    rgbAssetCount,
    rgbAssetsWithBalance,
    channelCount,
    seedOnlyInsufficient: hasRgbAtRisk || hasChannels,
    severity,
  };
}

/**
 * Assesses how much of the wallet is recoverable from the seed phrase alone.
 * Reads RGB assets from the store; the caller passes the live channel count
 * (the dashboard already has it from `listChannels()`).
 */
export function useBackupHealth(opts?: { channelCount?: number }): BackupHealth {
  const rgbAssets = useSelector((s: RootState) => s.assets?.rgbAssets ?? []);
  return computeBackupHealth({ rgbAssets, channelCount: opts?.channelCount ?? 0 });
}
