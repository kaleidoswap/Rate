import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { useAppLanguage } from '../../localization/useAppLanguage';
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
export function useRgbWalletSheets({ onViewAsset, onIssued }: {
  onViewAsset?: (asset: IssuedRgbAsset) => void;
  onIssued?: () => void;
} = {}) {
  const dispatch = useAppDispatch();
  const assets = (useAppSelector(s => s.assets?.rgbAssets) ?? NO_ASSETS) as Array<{ asset_id: string; ticker: string; precision?: number }>;
  const [open, setOpen] = useState<'utxos' | 'issue' | 'drain' | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const refresh = () => { void dispatch(refreshRgbAssets()); };
  const close = () => { setOpen(null); setReason(undefined); };

  const sheets = (
    <>
      <RgbUtxoSheet visible={open === 'utxos'} onClose={close} assets={assets} reason={reason} onCreated={refresh} />
      <IssueAssetSheet visible={open === 'issue'} onClose={close} onIssued={() => { refresh(); onIssued?.(); }}
        onCreateUtxos={() => { setReason('Issuing needs a free receive slot. Create some here, then issue once they confirm.'); setOpen('utxos'); }}
        onViewAsset={onViewAsset ? (asset) => { close(); onViewAsset(asset); } : undefined} />
      {open === 'drain' && <DrainSheet visible onClose={close} onDrained={() => { void dispatch(loadBtcBalance()); }} />}
    </>
  );
  return { sheets, openUtxos: () => setOpen('utxos'), openIssue: () => setOpen('issue'), openDrain: () => setOpen('drain') };
}

/** Settings › RGB: UTXOs and issuing, for the RGB account in use. */
export function RgbWalletTools({ onViewAsset, onIssued }: {
  onViewAsset?: (asset: IssuedRgbAsset) => void;
  onIssued?: () => void;
}) {
  const t = useAppTheme();
  const { t: translate } = useAppLanguage();
  const level = useAppSelector(selectDisclosureLevel);
  const support = rgbWalletSupport(rgbAccountAdapter());
  const { sheets, openUtxos, openIssue, openDrain } = useRgbWalletSheets({ onViewAsset, onIssued });
  if (!support.kind) return null;
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
    ...(level === 'advanced' && support.deleteTransfer ? [{ key: 'clear', icon: 'trash-outline' as const, label: 'Remove failed transfers', detail: 'Tidy the history: failed and expired transfers moved nothing', onPress: clearFailed }] : []),
    ...(level === 'advanced' && support.drain ? [{ key: 'drain', icon: 'exit-outline' as const, label: 'Send all bitcoin', detail: 'Empty the plain bitcoin to one address; assets stay', onPress: openDrain }] : []),
  ];
  if (!rows.length) return null;

  return (
    <>
      <View style={{ borderBottomColor: t.colors.border.light, borderBottomWidth: StyleSheet.hairlineWidth }}>
        {rows.map((row, index) => (
          <TouchableOpacity key={row.key} accessibilityRole="button" accessibilityLabel={translate(row.label)}
            accessibilityHint={translate(row.detail)} activeOpacity={0.7} onPress={() => { feedback.select(); row.onPress(); }}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2],
              paddingHorizontal: t.spacing[2.5], paddingVertical: t.spacing[1], borderTopColor: t.colors.border.light,
              borderTopWidth: index ? StyleSheet.hairlineWidth : 0 }}>
            <Ionicons name={row.icon} size={18} color={t.colors.text.secondary} />
            <Text style={{ flex: 1, fontSize: t.typography.fontSize.sm, fontWeight: '600', color: t.colors.text.primary }}>
              {translate(row.label)}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.text.tertiary} />
          </TouchableOpacity>
        ))}
      </View>
      {sheets}
    </>
  );
}
