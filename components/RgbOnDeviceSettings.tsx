// components/RgbOnDeviceSettings.tsx
//
// Settings › RGB account: RGB on this phone (rgb-lib, on-chain, mainnet or Mutinynet).
// The network is picked before the first start and then fixed for the wallet.
// Turning it on makes the RGB account a local wallet when no RGB node is paired.
// RGB state can't be rebuilt from the seed, so rgb-lib's encrypted backup is
// uploaded to the cloud after every change (services/protocols/rgbBackup.ts);
// these rows show that, back up on demand, or export the file. The indexer and
// RGB proxy can be changed per wallet.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { theme, protocolColor } from '../theme';
import DatabaseService from '../services/DatabaseService';
import { initializeProtocols, protocolManager } from '../services/protocols';
import {
  loadRgbL1Network, saveRgbL1Network, rgbBackupPassword, isRgbLibNativeAvailable, loadRgbL1Host, rgbL1Host, saveRgbL1Endpoints,
  pinnedRgbL1Network, RGB_L1_DEFAULT_NETWORK, RGB_L1_NETWORKS, RGB_L1_NETWORK_LABEL, type RgbL1Network,
} from '../services/protocols/rgbL1';
import { SegmentedTabs } from './SegmentedTabs';
import { toFilesystemPath } from '../services/protocols/bark';
import ToastService from '../services/ToastService';
import { onRgbBackupStatus, rgbBackupStatus, runRgbBackup, type RgbBackupStatus } from '../services/protocols/rgbBackup';

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
  const [network, setNetwork] = useState<RgbL1Network>(RGB_L1_DEFAULT_NETWORK);
  /** Set once this seed's RGB data exists on the phone: the network can't change after that. */
  const [pinned, setPinned] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupNeeded, setBackupNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloud, setCloud] = useState<RgbBackupStatus>(rgbBackupStatus());
  const [indexer, setIndexer] = useState('');
  const [proxy, setProxy] = useState('');
  const [endpointError, setEndpointError] = useState<string | null>(null);
  useEffect(() => onRgbBackupStatus(setCloud), []);
  const nodePaired = !!protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected();

  const refresh = useCallback(async () => {
    try {
      const mnemonic = await activeMnemonic(walletId);
      setEnabled(!!(await loadRgbL1Network(mnemonic)));
      const fixed = await pinnedRgbL1Network(mnemonic);
      setPinned(!!fixed);
      const net = fixed ?? network;
      if (fixed) setNetwork(fixed);
      const host = await loadRgbL1Host(mnemonic, net);
      setIndexer(host.indexerUrl);
      setProxy(host.transportEndpoint);
    } catch { setEnabled(false); }
    const account = rgbL1Account();
    setConnected(!!account);
    setBackupNeeded(account ? await account.backupRequired().catch(() => false) : false);
  }, [walletId, network]);

  useEffect(() => { void refresh(); }, [refresh]);

  const apply = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const mnemonic = await activeMnemonic(walletId);
      await saveRgbL1Network(mnemonic, on ? network : null);
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

  /** Save this wallet's indexer/proxy (null = network defaults) and reconnect with them. */
  const saveEndpoints = async (endpoints: { indexerUrl: string; transportEndpoint: string } | null) => {
    setBusy(true);
    setEndpointError(null);
    try {
      const mnemonic = await activeMnemonic(walletId);
      await saveRgbL1Endpoints(mnemonic, network, endpoints);
      if (protocolManager.getAdapterIfAvailable('RGB_L1')?.isConnected()) await protocolManager.disconnect('RGB_L1');
      const result = (await initializeProtocols(mnemonic, [])).get('RGB_L1');
      if (result && !result.success && !result.error?.startsWith('skipped')) throw new Error(result.error || 'RGB could not reconnect.');
    } catch (e: any) {
      setEndpointError(e?.message ?? 'Could not save the endpoints.');
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
      (network === 'mainnet'
        ? 'Holds RGB assets on-chain on Bitcoin mainnet, with real funds. '
        : 'Holds RGB assets on-chain on Mutinynet, a test network. ')
      + (pinned ? '' : `This wallet keeps its RGB data on ${RGB_L1_NETWORK_LABEL[network]} from now on. `)
      + 'RGB assets need more than your recovery phrase: they are backed up to the cloud after every send and receive and restored when you recover this wallet. You can also export a backup file.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn on', onPress: () => void apply(true) }],
    );
  };

  const backupNow = async () => {
    await runRgbBackup(true);
    await refresh();
  };

  const exportFile = async () => {
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
      ToastService.getInstance().success('RGB backup file created. Keep it with your recovery phrase.');
    } catch (e: any) {
      ToastService.getInstance().error(e?.message ?? 'Could not create the RGB backup.');
    } finally {
      setBackingUp(false);
    }
  };

  const color = protocolColor('RGB');
  const cloudColor = cloud.state === 'failed' || (backupNeeded && cloud.state !== 'backing-up') ? theme.colors.warning[500] : theme.colors.primary[500];
  const cloudLine = cloud.state === 'backing-up' ? 'Backing up…'
    : cloud.state === 'failed' ? `Last backup failed · ${cloud.error ?? 'retries on the next change'}`
    : backupNeeded ? 'Changed since the last backup · backs up automatically'
    : cloud.lastBackupAt ? `Backed up automatically · ${new Date(cloud.lastBackupAt).toLocaleString()}`
    : 'Backs up automatically after every send and receive';
  const native = isRgbLibNativeAvailable();
  const status = busy ? 'Starting…' : !enabled ? 'Off' : nodePaired ? 'Your RGB node is used while it’s connected' : connected ? `On · ${RGB_L1_NETWORK_LABEL[network]}` : 'Not connected';

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
      {!enabled && !pinned && native && (
        <View style={[styles.endpoints, styles.divider]}>
          <Text style={styles.fieldLabel}>Network</Text>
          <SegmentedTabs
            options={RGB_L1_NETWORKS.map((n) => ({ key: n, label: RGB_L1_NETWORK_LABEL[n] }))}
            value={network} onChange={setNetwork} fill />
          <Text style={styles.description}>
            {network === 'mainnet' ? 'Real bitcoin and RGB assets.' : 'Test bitcoin, no value.'} Fixed for this wallet once turned on.
          </Text>
        </View>
      )}
      {enabled && connected && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back up RGB data now" onPress={backupNow}
          disabled={cloud.state === 'backing-up'} activeOpacity={0.7} style={[styles.row, styles.divider]}>
          <View style={[styles.icon, { backgroundColor: cloudColor + '1A' }]}>
            <Ionicons name={cloud.state === 'failed' ? 'cloud-offline-outline' : 'cloud-done-outline'} size={18} color={cloudColor} />
          </View>
          <View style={styles.text}>
            <Text style={styles.label}>Cloud backup</Text>
            <Text style={[styles.description, (cloud.state === 'failed' || backupNeeded) && { color: cloudColor }]} numberOfLines={2}>
              {cloudLine}
            </Text>
          </View>
          {cloud.state === 'backing-up'
            ? <ActivityIndicator color={theme.colors.primary[500]} />
            : <Text style={styles.action}>Back up now</Text>}
        </TouchableOpacity>
      )}
      {enabled && connected && (
        <TouchableOpacity accessibilityRole="button" onPress={exportFile} activeOpacity={0.7} style={[styles.row, styles.divider]}>
          <View style={[styles.icon, { backgroundColor: theme.colors.text.secondary + '1A' }]}>
            <Ionicons name="share-outline" size={18} color={theme.colors.text.secondary} />
          </View>
          <View style={styles.text}>
            <Text style={styles.label}>Export backup file</Text>
            <Text style={styles.description} numberOfLines={2}>Encrypted with your recovery phrase · save it anywhere</Text>
          </View>
          {backingUp ? <ActivityIndicator color={theme.colors.primary[500]} /> : <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />}
        </TouchableOpacity>
      )}
      {enabled && (
        <View style={[styles.endpoints, styles.divider]}>
          <Text style={styles.label}>Network and servers</Text>
          <Text style={styles.description}>Network: {network === 'mainnet' ? 'Mainnet (real bitcoin)' : 'Mutinynet (test bitcoin)'}, fixed for this wallet. Saving reconnects RGB on this phone.</Text>
          <Text style={styles.fieldLabel}>Indexer (Esplora)</Text>
          <TextInput accessibilityLabel="RGB indexer URL" style={styles.input} value={indexer} onChangeText={setIndexer} editable={!busy}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholderTextColor={theme.colors.text.tertiary} />
          <Text style={styles.fieldLabel}>RGB proxy</Text>
          <TextInput accessibilityLabel="RGB proxy endpoint" style={styles.input} value={proxy} onChangeText={setProxy} editable={!busy}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholderTextColor={theme.colors.text.tertiary} />
          {!!endpointError && <Text accessibilityRole="alert" style={[styles.description, { color: theme.colors.error[500] }]}>{endpointError}</Text>}
          <View style={styles.endpointActions}>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { const d = rgbL1Host(network); setIndexer(d.indexerUrl); setProxy(d.transportEndpoint); void saveEndpoints(null); }}>
              <Text style={styles.secondaryAction}>Use defaults</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void saveEndpoints({ indexerUrl: indexer, transportEndpoint: proxy })}>
              <Text style={styles.action}>Save and reconnect</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  action: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.primary[500] },
  secondaryAction: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.secondary },
  endpoints: { paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[3], gap: theme.spacing[1.5] },
  fieldLabel: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: theme.spacing[1.5] },
  input: {
    color: theme.colors.text.primary, borderColor: theme.colors.border.medium, borderWidth: 1, borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3], minHeight: 44, fontSize: theme.typography.fontSize.sm,
  },
  endpointActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing[5], marginTop: theme.spacing[2], minHeight: 44, alignItems: 'center' },
});
