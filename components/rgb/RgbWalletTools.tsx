import React, { useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectDisclosureLevel } from '../../store/slices/settingsSlice';
import { refreshRgbAssets } from '../../store/slices/assetsSlice';
import { rgbAccountAdapter } from '../../services/protocols';
import { rgbWalletErrorMessage, rgbWalletSupport } from '../../utils/rgb-wallet';
import { deleteFailedRgbTransfers } from '../../services/rgbWallet';
import { feedback } from '../../utils/feedback';
import { RgbUtxoSheet } from './RgbUtxoSheet';
import { IssueAssetSheet } from './IssueAssetSheet';
import { DrainSheet } from './DrainSheet';
import { loadBtcBalance } from '../../store/slices/walletSlice';
import type { IssuedRgbAsset } from '../../services/rgbWallet';

const NO_ASSETS: never[] = [];

/** The RGB account's UTXO and issuance sheets, opened from anywhere that lists the RGB wallet's tools. */
export function useRgbWalletSheets({ onViewAsset }: { onViewAsset?: (asset: IssuedRgbAsset) => void } = {}) {
  const dispatch = useAppDispatch();
  const assets = (useAppSelector(s => s.assets?.rgbAssets) ?? NO_ASSETS) as Array<{ asset_id: string; ticker: string; precision?: number }>;
  const [open, setOpen] = useState<'utxos' | 'issue' | 'drain' | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const refresh = () => { void dispatch(refreshRgbAssets()); };
  const close = () => { setOpen(null); setReason(undefined); };

  const sheets = (
    <>
      <RgbUtxoSheet visible={open === 'utxos'} onClose={close} assets={assets} reason={reason} onCreated={refresh} />
      <IssueAssetSheet visible={open === 'issue'} onClose={close} onIssued={refresh}
        onCreateUtxos={() => { setReason('Issuing needs a free colorable UTXO. Create some here, then issue once they confirm.'); setOpen('utxos'); }}
        onViewAsset={onViewAsset ? (asset) => { close(); onViewAsset(asset); } : undefined} />
      {open === 'drain' && <DrainSheet visible onClose={close} onDrained={() => { void dispatch(loadBtcBalance()); }} />}
    </>
  );
  return { sheets, openUtxos: () => setOpen('utxos'), openIssue: () => setOpen('issue'), openDrain: () => setOpen('drain') };
}

/** Settings › RGB: UTXOs and issuing, for the RGB account in use (Advanced only). */
export function RgbWalletTools({ onViewAsset }: { onViewAsset?: (asset: IssuedRgbAsset) => void }) {
  const t = useAppTheme();
  const level = useAppSelector(selectDisclosureLevel);
  const support = rgbWalletSupport(rgbAccountAdapter());
  const { sheets, openUtxos, openIssue, openDrain } = useRgbWalletSheets({ onViewAsset });
  if (level !== 'advanced' || !support.kind) return null;
  const clearFailed = () => Alert.alert(
    'Remove failed transfers?',
    'Transfers that failed or expired moved nothing. Removing them only tidies your history.',
    [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            const removed = await deleteFailedRgbTransfers(rgbAccountAdapter());
            Alert.alert(removed ? 'Removed' : 'Nothing to remove', removed ? 'Failed transfers are gone from your history.' : 'There were no failed transfers.');
          } catch (e) {
            Alert.alert('Couldn’t remove them', rgbWalletErrorMessage(e, 'delete'));
          }
        },
      },
    ],
  );
  const rows = [
    ...(support.listUtxos || support.createUtxos ? [{ key: 'utxos', icon: 'cube-outline' as const, label: 'UTXOs', detail: 'Which outputs hold assets, which are free, and creating more', onPress: openUtxos }] : []),
    ...(support.issue.length ? [{ key: 'issue', icon: 'add-circle-outline' as const, label: 'Issue an asset', detail: support.issue.length > 1 ? 'A new token or collectible' : 'A new token', onPress: openIssue }] : []),
    ...(support.deleteTransfer ? [{ key: 'clear', icon: 'trash-outline' as const, label: 'Remove failed transfers', detail: 'Tidy the history: failed and expired transfers moved nothing', onPress: clearFailed }] : []),
    ...(support.drain ? [{ key: 'drain', icon: 'exit-outline' as const, label: 'Send all bitcoin', detail: 'Empty the plain bitcoin to one address; assets stay', onPress: openDrain }] : []),
  ];
  if (!rows.length) return null;

  return (
    <View style={{ gap: t.spacing[2], marginBottom: t.spacing[4] }}>
      <Text accessibilityRole="header" style={{ fontSize: t.typography.fontSize.xs, fontWeight: '700', color: t.colors.text.tertiary,
        textTransform: 'uppercase', letterSpacing: 0.6, marginLeft: t.spacing[1] }}>RGB wallet</Text>
      <View style={{ backgroundColor: t.colors.surface.primary, borderRadius: t.borderRadius.xl, borderWidth: 1, borderColor: t.colors.border.light, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <TouchableOpacity key={r.key} accessibilityRole="button" accessibilityLabel={r.label} activeOpacity={0.7}
            onPress={() => { feedback.select(); r.onPress(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], paddingHorizontal: t.spacing[4], minHeight: 60, paddingVertical: t.spacing[3],
              ...(i > 0 ? { borderTopWidth: 1, borderTopColor: t.colors.border.light } : {}) }}>
            <Ionicons name={r.icon} size={22} color={t.colors.text.secondary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: t.typography.fontSize.base, fontWeight: '600', color: t.colors.text.primary }}>{r.label}</Text>
              <Text style={{ fontSize: t.typography.fontSize.xs, color: t.colors.text.secondary, marginTop: 2 }} numberOfLines={2}>{r.detail}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.colors.text.tertiary} />
          </TouchableOpacity>
        ))}
      </View>
      {sheets}
    </View>
  );
}
