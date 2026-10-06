// components/RgbOnDeviceSettings.tsx
//
// Settings › Advanced: RGB on this phone (rgb-lib, on-chain, Mutinynet for now).
// Turning it on makes the RGB account a local wallet when no RGB node is paired;
// the backup row exports rgb-lib's encrypted backup, which the seed alone can't
// replace (RGB state and consignments live only in the wallet).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { theme, protocolColor } from '../theme';
import DatabaseService from '../services/DatabaseService';
import { initializeProtocols, protocolManager } from '../services/protocols';
import { loadRgbL1Network, saveRgbL1Network, rgbBackupPassword, isRgbLibNativeAvailable } from '../services/protocols/rgbL1';
import { toFilesystemPath } from '../services/protocols/bark';
import ToastService from '../services/ToastService';

const NETWORK = 'mutinynet' as const;

/** The rgb-lib account behind the RGB_L1 adapter, when connected. */
function rgbL1Account(): any {
  const adapter = protocolManager.getAdapterIfAvailable('RGB_L1') as any;
  return adapter?.isConnected?.() ? adapter.account : null;
}

async function activeMnemonic(walletId: number): Promise<string> {
  const wallet = await DatabaseService.getInstance().getActiveWallet();
  if (!wallet?.encrypted_mnemonic || wallet.id !== walletId) throw new Error('Unlock your active wallet first.');
  return wallet.encrypted_mnemonic;
}

export function RgbOnDeviceSettings({ walletId, onChanged }: { walletId: number; onChanged?: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupNeeded, setBackupNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodePaired = !!protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected();

  const refresh = useCallback(async () => {
    try {
      const mnemonic = await activeMnemonic(walletId);
      setEnabled(!!(await loadRgbL1Network(mnemonic)));
    } catch { setEnabled(false); }
    const account = rgbL1Account();
    setConnected(!!account);
    setBackupNeeded(account ? await account.backupRequired().catch(() => false) : false);
  }, [walletId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const apply = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const mnemonic = await activeMnemonic(walletId);
      await saveRgbL1Network(mnemonic, on ? NETWORK : null);
      setEnabled(on);
      if (on) {
        const result = (await initializeProtocols(mnemonic, [])).get('RGB_L1');
        if (result && !result.success) throw new Error(result.error || 'RGB could not start.');
      } else if (protocolManager.getAdapterIfAvailable('RGB_L1')?.isConnected()) {
        await protocolManager.disconnect('RGB_L1');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not change RGB.');
    } finally {
      await refresh();
      setBusy(false);
      onChanged?.();
    }
  };

  const toggle = (on: boolean) => {
    if (busy) return;
    if (!on) {
      Alert.alert('Turn off RGB on this phone?', 'Your RGB data stays on the phone and comes back when you turn it on again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => void apply(false) },
      ]);
      return;
    }
    Alert.alert(
      'RGB on this phone (beta)',
      'Holds RGB assets on-chain on Mutinynet, a test network. Your recovery phrase alone can’t restore RGB assets: back up your RGB data after each receive.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn on', onPress: () => void apply(true) }],
    );
  };

  const backup = async () => {
    const account = rgbL1Account();
    if (!account || backingUp) return;
    setBackingUp(true);
    try {
      const mnemonic = await activeMnemonic(walletId);
      const file = new File(Paths.cache, `kaleidoswap-rgb-${new Date().toISOString().slice(0, 10)}.rgbbackup`);
      if (file.exists) file.delete();
      await account.backup(toFilesystemPath(file.uri), rgbBackupPassword(mnemonic));
      setBackupNeeded(false);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { dialogTitle: 'Save your RGB backup', mimeType: 'application/octet-stream' });
      }
      ToastService.getInstance().success('RGB backup created. Keep it with your recovery phrase.');
    } catch (e: any) {
      ToastService.getInstance().error(e?.message ?? 'Could not create the RGB backup.');
    } finally {
      setBackingUp(false);
    }
  };

  const color = protocolColor('RGB');
  const native = isRgbLibNativeAvailable();
  const status = busy ? 'Starting…' : !enabled ? 'Off' : nodePaired ? 'Your RGB node is used while it’s connected' : connected ? 'On · Mutinynet' : 'Not connected';

  return (
    <View>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: color + '1A' }]}>
          <Ionicons name="phone-portrait-outline" size={18} color={color} />
        </View>
        <View style={styles.text}>
          <Text style={styles.label}>RGB on this phone</Text>
          <Text style={styles.description} numberOfLines={2}>
            {native ? `On-chain RGB assets, no node needed · beta · ${status}` : 'Needs a newer app build'}
          </Text>
          {!!error && <Text style={[styles.description, { color: theme.colors.error[500] }]} numberOfLines={2}>{error}</Text>}
        </View>
        {busy
          ? <ActivityIndicator color={color} />
          : <Switch accessibilityLabel="RGB on this phone" value={enabled} disabled={!native} onValueChange={toggle}
              trackColor={{ true: theme.colors.primary[500], false: theme.colors.gray[300] }} />}
      </View>
      {enabled && connected && (
        <TouchableOpacity accessibilityRole="button" onPress={backup} activeOpacity={0.7} style={[styles.row, styles.divider]}>
          <View style={[styles.icon, { backgroundColor: (backupNeeded ? theme.colors.warning[500] : theme.colors.primary[500]) + '1A' }]}>
            <Ionicons name="cloud-upload-outline" size={18} color={backupNeeded ? theme.colors.warning[500] : theme.colors.primary[500]} />
          </View>
          <View style={styles.text}>
            <Text style={styles.label}>Back up RGB data</Text>
            <Text style={[styles.description, backupNeeded && { color: theme.colors.warning[500] }]} numberOfLines={2}>
              {backupNeeded ? 'Changed since the last backup · back up now' : 'Encrypted with your recovery phrase'}
            </Text>
          </View>
          {backingUp ? <ActivityIndicator color={theme.colors.primary[500]} /> : <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 64, paddingVertical: theme.spacing[3] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  description: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
});
