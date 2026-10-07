// components/RgbOnDeviceSettings.tsx
//
// Settings › RGB › RGB on this phone (rgb-lib, on-chain, mainnet or Mutinynet).
// Before it starts: pick the network (servers under Advanced), then Connect, or
// restore this wallet's RGB data from the cloud backup or an exported file.
// Connect looks for a cloud backup first and asks before restoring it.
// The network is fixed once the wallet started on it (rgb-lib keeps one data
// folder per seed). Once connected: status, back up now, export a file, the
// servers, and turning it off. While an RGB node is connected it is the RGB
// account and this wallet steps aside.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { theme } from '../theme';
import DatabaseService from '../services/DatabaseService';
import { protocolManager, reconcileRgbOnDevice } from '../services/protocols';
import {
  loadRgbL1Network, saveRgbL1Network, rgbBackupPassword, isRgbLibNativeAvailable, loadRgbL1Host, saveRgbL1Endpoints,
  lockedRgbL1Network, pinnedRgbL1Network, markRgbL1Ready, rgbL1Host, RGB_L1_DEFAULT_NETWORK, RGB_L1_NETWORKS, RGB_L1_NETWORK_LABEL,
  type RgbL1Network,
} from '../services/protocols/rgbL1';
import { SegmentedTabs } from './SegmentedTabs';
import { Button } from './Button';
import { Callout } from './Callout';
import { toFilesystemPath } from '../services/protocols/bark';
import ToastService from '../services/ToastService';
import {
  findRgbCloudBackup, onRgbBackupStatus, restoreRgbFromCloud, restoreRgbFromFile, rgbBackupStatus, runRgbBackup, type RgbBackupStatus,
} from '../services/protocols/rgbBackup';

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

const nativeRestore = (path: string, password: string) => require('react-native-rgb').restoreBackup(path, password);
const messageOf = (e: any, fallback: string) => (e?.message ? String(e.message) : fallback);

/** A start that didn't happen, in words (the engine's "skipped: …" reasons included). */
export function rgbStartError(error?: string): string {
  if (!error) return 'RGB on this phone didn’t start. Try again.';
  if (/RGB Lightning Node is the RGB account/.test(error)) {
    return 'Your RGB Lightning Node is the RGB account while it’s connected. Remove it to use RGB on this phone.';
  }
  return error.replace(/^skipped:\s*/, '');
}

type Phase = 'checking' | 'connecting' | 'restoring' | 'stopping' | 'saving';
type Restore = { kind: 'cloud' } | { kind: 'file'; uri: string };

export function RgbOnDeviceSettings({ walletId, nodeActive = false, onOpenNode, onChanged }: {
  walletId: number;
  /** An RGB Lightning Node is connected: it is the RGB account, this wallet steps aside. */
  nodeActive?: boolean;
  onOpenNode?: () => void;
  onChanged?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  /** The network RGB on this phone is turned on for, or null when it's off. */
  const [enabled, setEnabled] = useState<RgbL1Network | null>(null);
  /** Set once this seed's RGB data exists on the phone: the network can't change after that. */
  const [locked, setLocked] = useState<RgbL1Network | null>(null);
  const [network, setNetwork] = useState<RgbL1Network>(RGB_L1_DEFAULT_NETWORK);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [backupNeeded, setBackupNeeded] = useState(false);
  const [cloud, setCloud] = useState<RgbBackupStatus>(rgbBackupStatus());
  const [showServers, setShowServers] = useState(false);
  const [indexer, setIndexer] = useState('');
  const [proxy, setProxy] = useState('');
  const [serversEdited, setServersEdited] = useState(false);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  useEffect(() => onRgbBackupStatus(setCloud), []);

  const refresh = useCallback(async () => {
    const account = rgbL1Account();
    setConnected(!!account);
    try {
      const mnemonic = await activeMnemonic(walletId);
      const [on, fixed, pinned] = await Promise.all([loadRgbL1Network(mnemonic), lockedRgbL1Network(mnemonic), pinnedRgbL1Network(mnemonic)]);
      setEnabled(on);
      setLocked(fixed);
      // A fixed network wins; otherwise show the last choice, else keep what's picked.
      const shown = fixed ?? on ?? pinned;
      if (shown) setNetwork(shown);
    } catch (e: any) {
      setError(messageOf(e, 'Could not read the RGB settings.'));
    }
    setBackupNeeded(account ? await account.backupRequired().catch(() => false) : false);
    setLoaded(true);
  }, [walletId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The servers shown are this wallet's own for the network, else its defaults.
  useEffect(() => {
    let live = true;
    setServersEdited(false);
    setEndpointError(null);
    const defaults = rgbL1Host(network);
    setIndexer(defaults.indexerUrl);
    setProxy(defaults.transportEndpoint);
    activeMnemonic(walletId)
      .then((mnemonic) => loadRgbL1Host(mnemonic, network))
      .then((host) => { if (live) { setIndexer(host.indexerUrl); setProxy(host.transportEndpoint); } })
      .catch(() => undefined); // the defaults stay shown; refresh() reports a locked wallet
    return () => { live = false; };
  }, [walletId, network]);

  const label = RGB_L1_NETWORK_LABEL[network];
  const busy = phase !== null;

  /** Starts RGB on this phone on the chosen network, optionally from a backup first. */
  const run = async (restore: Restore | null) => {
    setPhase(restore ? 'restoring' : 'connecting');
    setError(null);
    const wasOn = enabled;
    let mnemonic: string | null = null;
    try {
      mnemonic = await activeMnemonic(walletId);
      if (serversEdited) await saveRgbL1Endpoints(mnemonic, network, { indexerUrl: indexer, transportEndpoint: proxy });
      // Save the choice first: it refuses a network other than the one this wallet's data is on.
      await saveRgbL1Network(mnemonic, network);
      if (restore?.kind === 'cloud') {
        const result = await restoreRgbFromCloud({ mnemonic, network, restore: nativeRestore });
        if (result === 'no-backup') throw new Error(`There’s no RGB backup of this wallet on ${label}.`);
        await markRgbL1Ready(mnemonic, network);
      } else if (restore?.kind === 'file') {
        await restoreRgbFromFile({ mnemonic, path: toFilesystemPath(restore.uri), restore: nativeRestore });
        await markRgbL1Ready(mnemonic, network);
      }
      // The restore question was asked here: no automatic cloud restore on this start.
      const result = await reconcileRgbOnDevice({ skipCloudRestore: true });
      if (!result?.success) throw new Error(rgbStartError(result?.error));
      ToastService.getInstance().success(restore ? 'RGB data restored.' : `RGB on this phone is connected on ${label}.`);
    } catch (e: any) {
      // It didn't start: leave it off as it was. A network that never started stays changeable.
      if (!wasOn && mnemonic) await saveRgbL1Network(mnemonic, null).catch(() => undefined);
      setError(messageOf(e, 'Could not start RGB on this phone.'));
    } finally {
      await refresh();
      setPhase(null);
      onChanged?.();
    }
  };

  /** Asks before starting empty over a cloud backup; `cloud` restores or says there is none. */
  const lookForBackup = async (mode: 'connect' | 'cloud') => {
    setPhase('checking');
    setError(null);
    let manifest: Awaited<ReturnType<typeof findRgbCloudBackup>> = null;
    try {
      manifest = await findRgbCloudBackup(await activeMnemonic(walletId), network);
    } catch (e: any) {
      setPhase(null);
      setError(`Couldn’t check for a cloud backup (${messageOf(e, 'no answer')}). Check your connection and try again.`);
      return;
    }
    setPhase(null);
    if (!manifest) {
      if (mode === 'cloud') Alert.alert('No cloud backup', `There’s no RGB backup of this wallet on ${label}. Try the other network, or restore from a file.`);
      else await run(null);
      return;
    }
    const when = new Date(manifest.createdAt).toLocaleString();
    Alert.alert('Cloud backup found', `This wallet has an RGB backup on ${label} from ${when}. Restore it to get your RGB assets back on this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      ...(mode === 'connect' ? [{ text: 'Start empty', style: 'destructive' as const, onPress: confirmStartEmpty }] : []),
      { text: 'Restore', onPress: () => run({ kind: 'cloud' }) },
    ]);
  };

  const confirmStartEmpty = () => {
    Alert.alert('Start without the backup?', 'The RGB assets in the cloud backup won’t be on this phone, and its next automatic backup replaces the cloud copy.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start empty', style: 'destructive', onPress: () => run(null) },
    ]);
  };

  const connect = () => {
    if (busy) return;
    if (locked) { void run(null); return; } // its data is already on this phone
    Alert.alert(
      'RGB on this phone (beta)',
      (network === 'mainnet'
        ? 'Holds RGB assets on-chain on Bitcoin mainnet, with real funds. '
        : 'Holds RGB assets on-chain on Mutinynet, a test network. ')
      + `This wallet keeps its RGB data on ${label} once it starts. `
      + 'RGB assets need more than your recovery phrase: they are backed up to the cloud after every send and receive. You can also export a backup file.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => lookForBackup('connect') }],
    );
  };

  const restoreCloud = () => { if (!busy) void lookForBackup('cloud'); };

  /** Bring RGB data back from an exported file. */
  const restoreFile = async () => {
    if (busy) return;
    setError(null);
    // Loaded on use: an OTA update can run on a build without the file picker.
    let picker: any = null;
    try { picker = require('expo-document-picker'); } catch { /* older build */ }
    if (!picker?.getDocumentAsync) { setError('Restoring from a file needs a newer app build.'); return; }
    let picked: any;
    try {
      picked = await picker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
    } catch (e: any) {
      setError(`Couldn’t open the file (${messageOf(e, 'file picker failed')}).`);
      return;
    }
    const uri = picked && !picked.canceled ? picked.assets?.[0]?.uri : null;
    if (!uri) return;
    Alert.alert('Restore RGB data?', `RGB on this phone starts from this file, on ${label}. It must be a backup of this wallet.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: () => run({ kind: 'file', uri }) },
    ]);
  };

  const turnOff = () => {
    if (busy) return;
    Alert.alert('Turn off RGB on this phone?', 'Your RGB data stays on the phone and comes back when you connect again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: async () => {
        setPhase('stopping');
        setError(null);
        try {
          await saveRgbL1Network(await activeMnemonic(walletId), null);
          await reconcileRgbOnDevice(); // releases the wallet and its backups
        } catch (e: any) {
          setError(messageOf(e, 'Could not turn off RGB on this phone.'));
        } finally {
          await refresh();
          setPhase(null);
          onChanged?.();
        }
      } },
    ]);
  };

  /** Save this wallet's indexer/proxy (null = network defaults) and reconnect with them. */
  const saveEndpoints = async (endpoints: { indexerUrl: string; transportEndpoint: string } | null) => {
    setPhase('saving');
    setEndpointError(null);
    try {
      const mnemonic = await activeMnemonic(walletId);
      await saveRgbL1Endpoints(mnemonic, network, endpoints);
      setServersEdited(false);
      if (protocolManager.getAdapterIfAvailable('RGB_L1')?.isConnected()) await protocolManager.disconnect('RGB_L1');
      const result = await reconcileRgbOnDevice();
      if (!result?.success) throw new Error(rgbStartError(result?.error));
    } catch (e: any) {
      setEndpointError(messageOf(e, 'Could not save the servers.'));
    } finally {
      await refresh();
      setPhase(null);
      onChanged?.();
    }
  };

  const backupNow = async () => {
    await runRgbBackup(true);
    await refresh();
  };

  const exportFile = async () => {
    const account = rgbL1Account();
    if (!account || exporting) return;
    setExporting(true);
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
      ToastService.getInstance().error(messageOf(e, 'Could not create the RGB backup.'));
    } finally {
      setExporting(false);
    }
  };

  const accent = theme.colors.primary[500];
  const errorText = !!error && <Callout tone="error" message={error} style={styles.callout} />;
  const sectionLabel = (text: string) => <Text accessibilityRole="header" style={styles.sectionLabel}>{text}</Text>;
  const rowIcon = (name: keyof typeof Ionicons.glyphMap, tint: string = theme.colors.text.secondary) => (
    <View style={[styles.icon, { backgroundColor: tint + '1A' }]}><Ionicons name={name} size={18} color={tint} /></View>
  );
  const chevron = <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />;

  if (!isRgbLibNativeAvailable()) {
    return <View style={styles.section}><Text style={styles.description}>RGB on this phone needs a newer app build.</Text></View>;
  }
  if (!loaded) {
    return <View style={styles.section}><ActivityIndicator color={accent} /></View>;
  }

  if (nodeActive) {
    return (
      <View style={styles.section}>
        <Callout tone="info" message={`Your RGB Lightning Node is the RGB account while it’s connected. ${enabled
          ? `RGB on this phone (${RGB_L1_NETWORK_LABEL[enabled]}) comes back when you remove the node.`
          : 'To use RGB on this phone instead, remove the node connection first.'}`} />
        {onOpenNode && <Button title="Manage RGB node" variant="secondary" onPress={onOpenNode} fullWidth />}
      </View>
    );
  }

  const servers = (
    <View style={styles.fields}>
      <Text style={styles.fieldLabel}>Indexer (Esplora)</Text>
      <TextInput accessibilityLabel="RGB indexer URL" style={styles.input} value={indexer} editable={!busy}
        onChangeText={(v) => { setIndexer(v); setServersEdited(true); }}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholderTextColor={theme.colors.text.tertiary} />
      <Text style={styles.fieldLabel}>RGB proxy</Text>
      <TextInput accessibilityLabel="RGB proxy endpoint" style={styles.input} value={proxy} editable={!busy}
        onChangeText={(v) => { setProxy(v); setServersEdited(true); }}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholderTextColor={theme.colors.text.tertiary} />
      {!!endpointError && <Callout tone="error" message={endpointError} />}
      {connected ? (
        <View style={styles.inlineActions}>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { const d = rgbL1Host(network); setIndexer(d.indexerUrl); setProxy(d.transportEndpoint); void saveEndpoints(null); }}>
            <Text style={styles.secondaryAction}>Use defaults</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void saveEndpoints({ indexerUrl: indexer, transportEndpoint: proxy })}>
            <Text style={styles.action}>Save and reconnect</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.inlineActions}>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { const d = rgbL1Host(network); setIndexer(d.indexerUrl); setProxy(d.transportEndpoint); setServersEdited(true); }}>
            <Text style={styles.secondaryAction}>Use defaults</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const advanced = (
    <>
      {sectionLabel('Advanced')}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showServers }} onPress={() => setShowServers((v) => !v)}
        activeOpacity={0.7} style={styles.row}>
        {rowIcon('server-outline')}
        <View style={styles.text}>
          <Text style={styles.label}>Servers</Text>
          <Text style={styles.description} numberOfLines={1}>Indexer and RGB proxy for {label}</Text>
        </View>
        <Ionicons name={showServers ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.text.tertiary} />
      </TouchableOpacity>
      {showServers && servers}
    </>
  );

  if (connected) {
    const cloudWarn = cloud.state === 'failed' || (backupNeeded && cloud.state !== 'backing-up');
    const cloudColor = cloudWarn ? theme.colors.warning[500] : accent;
    const cloudLine = cloud.state === 'backing-up' ? 'Backing up…'
      : cloud.state === 'failed' ? `Last backup failed · ${cloud.error ?? 'retries on the next change'}`
      : backupNeeded ? 'Changed since the last backup · backs up automatically'
      : cloud.lastBackupAt ? `Backed up · ${new Date(cloud.lastBackupAt).toLocaleString()}`
      : 'Backs up after every send and receive';
    return (
      <View>
        <View style={styles.row}>
          {rowIcon('checkmark-circle', theme.colors.success[500])}
          <View style={styles.text}>
            <Text style={styles.label}>Connected · {label}</Text>
            <Text style={styles.description} numberOfLines={1}>Network fixed for this wallet</Text>
          </View>
          {busy && <ActivityIndicator color={accent} />}
        </View>
        {errorText}
        {sectionLabel('Backup')}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back up RGB data now" onPress={backupNow}
          disabled={cloud.state === 'backing-up'} activeOpacity={0.7} style={styles.row}>
          {rowIcon(cloud.state === 'failed' ? 'cloud-offline-outline' : 'cloud-done-outline', cloudColor)}
          <View style={styles.text}>
            <Text style={styles.label}>Cloud backup</Text>
            <Text style={[styles.description, cloudWarn && { color: cloudColor }]} numberOfLines={2}>{cloudLine}</Text>
          </View>
          {cloud.state === 'backing-up' ? <ActivityIndicator color={accent} /> : <Text style={styles.action}>Back up now</Text>}
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={exportFile} activeOpacity={0.7} style={[styles.row, styles.divider]}>
          {rowIcon('share-outline')}
          <View style={styles.text}>
            <Text style={styles.label}>Export backup file</Text>
            <Text style={styles.description} numberOfLines={1}>Encrypted with your recovery phrase</Text>
          </View>
          {exporting ? <ActivityIndicator color={accent} /> : chevron}
        </TouchableOpacity>
        {advanced}
        <TouchableOpacity accessibilityRole="button" onPress={turnOff} disabled={busy} activeOpacity={0.7} style={[styles.row, styles.divider]}>
          {rowIcon('power-outline')}
          <View style={styles.text}>
            <Text style={[styles.label, styles.danger]}>Disconnect</Text>
            <Text style={styles.description} numberOfLines={1}>Your RGB data stays on this phone</Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  // Not connected: choose the network, then connect; or restore what you had.
  const connectTitle = phase === 'checking' ? 'Checking for a backup…'
    : phase === 'connecting' ? 'Connecting…'
    : phase === 'restoring' ? 'Restoring…'
    : enabled ? 'Try again' : 'Connect';
  return (
    <View>
      <View style={styles.section}>
        <Text style={styles.label}>Network</Text>
        {locked ? (
          <View style={styles.locked}>
            <Ionicons name="lock-closed-outline" size={14} color={theme.colors.text.secondary} />
            <Text style={[styles.description, styles.text]}>{RGB_L1_NETWORK_LABEL[locked]} · fixed for this wallet</Text>
          </View>
        ) : (
          <>
            <SegmentedTabs scrollable={false} fill
              options={RGB_L1_NETWORKS.map((n) => ({ key: n, label: RGB_L1_NETWORK_LABEL[n], disabled: busy }))}
              value={network} onChange={setNetwork} />
            <Text style={styles.description}>
              {network === 'mainnet' ? 'Real bitcoin and RGB assets.' : 'Test bitcoin, no value.'} Can’t be changed once started.
            </Text>
          </>
        )}
        {enabled && !busy && (
          <Text style={styles.description}>On for {RGB_L1_NETWORK_LABEL[enabled]} but not connected.</Text>
        )}
        {errorText}
        <Button title={connectTitle} onPress={connect} disabled={busy} loading={phase === 'connecting' || phase === 'checking'} fullWidth style={styles.primary} />
      </View>
      {!locked && (
        <>
          {sectionLabel('Already have RGB assets?')}
          <TouchableOpacity accessibilityRole="button" onPress={restoreCloud} disabled={busy} activeOpacity={0.7} style={styles.row}>
            {rowIcon('cloud-download-outline')}
            <View style={styles.text}>
              <Text style={styles.label}>Restore from cloud</Text>
              <Text style={styles.description} numberOfLines={1}>This wallet’s automatic backup on {label}</Text>
            </View>
            {phase === 'restoring' ? <ActivityIndicator color={accent} /> : chevron}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={restoreFile} disabled={busy} activeOpacity={0.7} style={[styles.row, styles.divider]}>
            {rowIcon('document-attach-outline')}
            <View style={styles.text}>
              <Text style={styles.label}>Restore from a backup file</Text>
              <Text style={styles.description} numberOfLines={1}>A file you exported before</Text>
            </View>
            {chevron}
          </TouchableOpacity>
        </>
      )}
      {advanced}
      {enabled && (
        <TouchableOpacity accessibilityRole="button" onPress={turnOff} disabled={busy} activeOpacity={0.7} style={[styles.row, styles.divider]}>
          {rowIcon('power-outline')}
          <View style={styles.text}>
            <Text style={[styles.label, styles.danger]}>Turn off</Text>
            <Text style={styles.description} numberOfLines={1}>Stop trying to connect RGB on this phone</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 60, paddingVertical: theme.spacing[3] },
  section: { paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[4], gap: theme.spacing[2] },
  sectionLabel: {
    fontSize: theme.typography.fontSize.xs, fontWeight: '700', color: theme.colors.text.tertiary, textTransform: 'uppercase', letterSpacing: 0.6,
    paddingHorizontal: theme.spacing[4], paddingTop: theme.spacing[4], paddingBottom: theme.spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  description: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
  danger: { color: theme.colors.error[500] },
  callout: { marginHorizontal: theme.spacing[4], marginBottom: theme.spacing[3] },
  primary: { marginTop: theme.spacing[2] },
  locked: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1.5] },
  action: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.primary[500] },
  secondaryAction: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.secondary },
  fields: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[3], gap: theme.spacing[1.5] },
  fieldLabel: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: theme.spacing[1.5] },
  input: {
    color: theme.colors.text.primary, borderColor: theme.colors.border.medium, borderWidth: 1, borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3], minHeight: 44, fontSize: theme.typography.fontSize.sm,
  },
  inlineActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing[5], marginTop: theme.spacing[2], minHeight: 44, alignItems: 'center' },
});
