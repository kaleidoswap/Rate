// screens/NWCConnectScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity, Clipboard } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';

import { Button, Input, MainHeader } from '../components';
import { theme, leading } from '../theme';
import { RootState } from '../store';
import { protocolManager } from '../services/protocols';
import DatabaseService from '../services/DatabaseService';
import { setActiveWallet, loadBtcBalance } from '../store/slices/walletSlice';
import { syncAssets } from '../store/slices/assetsSlice';
import {
  setConnectedWallet,
  setNWCConnectionString,
  setNwcWalletType,
} from '../store/slices/nostrSlice';
import {
  NWCClient,
  parseNwcUri,
  type NwcGetInfoResult,
} from '../services/nwc/NWCExternalClient';

const STORAGE_KEY = 'nwc_connection_string';

interface Props {
  navigation: any;
  route?: { params?: { scanned?: string } };
}

type WalletType = 'ln' | 'rln';

/**
 * Connect this app to an external Lightning wallet over Nostr Wallet Connect
 * (NIP-47) — paste or scan its `nostr+walletconnect://` string. On connect we
 * detect whether it's a plain Lightning wallet or a KaleidoSwap RGB Lightning
 * Node (RLN), persist it, enroll it as the wallet's RGB/LN network, and activate
 * it as the app's payment backend (so the rest of the app pays through it).
 */
const NWCConnectScreen: React.FC<Props> = ({ navigation, route }) => {
  const dispatch = useDispatch();
  const activeWallet = useSelector((s: RootState) => s.wallet?.activeWallet);
  const storedType = useSelector((s: RootState) => s.nostr?.nwcWalletType);

  const [connectionString, setConnectionString] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<NwcGetInfoResult | null>(null);
  const [walletType, setWalletType] = useState<WalletType | null>(storedType ?? null);
  const [balanceSats, setBalanceSats] = useState<number | null>(null);

  const [invoice, setInvoice] = useState('');
  const [paying, setPaying] = useState(false);

  // Enroll the connected wallet as an `rln` network on the active wallet so it
  // reconnects automatically on app launch (NwcRgbAdapter reads the string from
  // SecureStore). Idempotent: updates the existing entry if present.
  const enrollNetwork = useCallback(
    async (network: string) => {
      const walletId = activeWallet?.id;
      if (!walletId) return;
      const db = DatabaseService.getInstance();
      const config = JSON.stringify({ via: 'nwc', network });
      const existing = (activeWallet?.networks || []).find((n: any) => n.type === 'rln');
      if (existing) {
        await db.updateNetworkConfig(walletId, 'rln', { enabled: true, config });
      } else {
        await db.addNetworkToWallet(walletId, { type: 'rln', enabled: true, config });
      }
      const refreshed = await db.getActiveWallet();
      if (refreshed) dispatch(setActiveWallet(refreshed));
    },
    [activeWallet, dispatch],
  );

  // Persist + enroll + activate + sync, then land on the Dashboard.
  const finalize = useCallback(
    async (uri: string, type: WalletType, network: string, walletPubkey: string) => {
      setLoading(true);
      try {
        // 1) Persist the string (the adapter reads it from here).
        await SecureStore.setItemAsync(STORAGE_KEY, uri);
        // 2) Enroll the network so it reconnects on launch.
        await enrollNetwork(network);
        // 3) Activate the adapter now.
        await protocolManager.connect('RGB', { protocol: 'RGB', network } as any);
        await protocolManager.setActiveProtocol('RGB');
        // 4) Reflect in Redux + pull fresh balances/assets through the new wallet.
        dispatch(setConnectedWallet(walletPubkey));
        dispatch(setNWCConnectionString(uri));
        dispatch(setNwcWalletType(type));
        dispatch(loadBtcBalance() as any);
        if (activeWallet?.id) dispatch(syncAssets(activeWallet.id) as any);

        setSaved(true);
        // 5) Done — go to the wallet home.
        navigation.navigate('Dashboard');
      } catch (e) {
        Alert.alert('Connection failed', e instanceof Error ? e.message : 'Could not activate the wallet');
      } finally {
        setLoading(false);
      }
    },
    [dispatch, enrollNetwork, activeWallet?.id, navigation],
  );

  // Probe the wallet (info + balance), detect its type, then ask the user to
  // confirm what they're about to connect before we persist/activate anything.
  const connect = useCallback(
    async (uri: string) => {
      let parsed;
      try {
        parsed = parseNwcUri(uri);
      } catch (e) {
        Alert.alert('Invalid connection string', e instanceof Error ? e.message : '');
        return;
      }
      setLoading(true);
      let client: NWCClient | null = null;
      try {
        client = new NWCClient(uri, { timeoutMs: 20_000 });
        const [nodeInfo, balance] = await Promise.all([client.getInfo(), client.getBalance()]);

        const isRln = (nodeInfo.methods ?? []).some((m) => m.startsWith('rln_'));
        const type: WalletType = isRln ? 'rln' : 'ln';
        const network = nodeInfo.network || 'regtest';
        const sats = Math.floor(balance.balance / 1000);

        setInfo(nodeInfo);
        setWalletType(type);
        setBalanceSats(sats);
        setLoading(false); // probe done; finalize() manages its own loading

        const typeName = isRln ? 'RGB Lightning Node' : 'Lightning wallet';
        const capabilities = isRln
          ? '• Send & receive Bitcoin (Lightning)\n• Send & receive RGB assets (USDT, XAUT…)'
          : '• Send & receive Bitcoin (Lightning)\n• RGB assets not supported on this wallet';
        Alert.alert(
          `Connect ${typeName}?`,
          `${nodeInfo.alias ? `${nodeInfo.alias}\n` : ''}Balance: ${sats.toLocaleString()} sats · ${network}\n\nThis wallet will be used to:\n${capabilities}`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setLoading(false) },
            { text: 'Connect', onPress: () => finalize(uri, type, network, parsed!.walletPubkey) },
          ],
        );
      } catch (e) {
        setLoading(false);
        Alert.alert('Connection failed', e instanceof Error ? e.message : 'Could not reach the wallet');
      } finally {
        client?.close();
      }
    },
    [finalize],
  );

  // Load any saved string; auto-connect when arriving from a QR scan.
  useEffect(() => {
    const scanned = route?.params?.scanned;
    if (scanned) {
      setConnectionString(scanned);
      navigation.setParams?.({ scanned: undefined });
      connect(scanned.trim());
      return;
    }
    SecureStore.getItemAsync(STORAGE_KEY).then((stored) => {
      if (stored) {
        setConnectionString(stored);
        setSaved(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.scanned]);

  const handlePaste = async () => {
    const text = await Clipboard.getString();
    if (text) setConnectionString(text.trim());
  };

  const handleScan = () => {
    navigation.navigate('QRScanner');
  };

  const handleDisconnect = async () => {
    try {
      await protocolManager.disconnect('RGB');
    } catch {
      /* ignore */
    }
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    const walletId = activeWallet?.id;
    if (walletId) {
      try {
        await DatabaseService.getInstance().updateNetworkConfig(walletId, 'rln', { enabled: false });
        const refreshed = await DatabaseService.getInstance().getActiveWallet();
        if (refreshed) dispatch(setActiveWallet(refreshed));
      } catch {
        /* ignore */
      }
    }
    dispatch(setConnectedWallet(null));
    dispatch(setNWCConnectionString(null));
    dispatch(setNwcWalletType(null));
    setConnectionString('');
    setSaved(false);
    setInfo(null);
    setWalletType(null);
    setBalanceSats(null);
    Alert.alert('Disconnected', 'Lightning wallet removed');
  };

  const handlePay = async () => {
    const inv = invoice.trim();
    if (!inv) return;
    setPaying(true);
    let client: NWCClient | null = null;
    try {
      client = new NWCClient(connectionString.trim(), { timeoutMs: 90_000 });
      const res = await client.payInvoice({ invoice: inv });
      Alert.alert('Payment sent', `Preimage ${res.preimage.slice(0, 16)}…`);
      setInvoice('');
      const balance = await client.getBalance();
      setBalanceSats(Math.floor(balance.balance / 1000));
    } catch (e) {
      Alert.alert('Payment failed', e instanceof Error ? e.message : '');
    } finally {
      client?.close();
      setPaying(false);
    }
  };

  const isRln = walletType === 'rln';

  return (
    <View style={styles.container}>
      <MainHeader title="Connect a Lightning wallet" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Paste or scan a Nostr Wallet Connect string from your Lightning wallet (e.g. the
          KaleidoSwap desktop node, Alby, or any NWC wallet). We'll detect the wallet type and use
          it to send and check balances.
        </Text>

        <Input
          label="Connection string"
          placeholder="nostr+walletconnect://..."
          value={connectionString}
          onChangeText={setConnectionString}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          editable={!loading}
        />

        <View style={styles.inputActions}>
          <TouchableOpacity style={styles.actionChip} onPress={handlePaste} disabled={loading}>
            <Ionicons name="clipboard-outline" size={16} color={theme.colors.primary[500]} />
            <Text style={styles.actionChipText}>Paste</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={handleScan} disabled={loading}>
            <Ionicons name="qr-code-outline" size={16} color={theme.colors.primary[500]} />
            <Text style={styles.actionChipText}>Scan</Text>
          </TouchableOpacity>
        </View>

        <Button
          title={loading ? 'Connecting…' : saved ? 'Reconnect' : 'Connect'}
          onPress={() => connect(connectionString.trim())}
          disabled={loading || !connectionString.trim()}
          loading={loading}
        />

        {saved && walletType && (
          <View style={styles.card}>
            <View style={styles.typeRow}>
              <View
                style={[
                  styles.typeBadge,
                  { backgroundColor: (isRln ? theme.colors.primary[500] : theme.colors.warning[500]) + '22' },
                ]}
              >
                <Ionicons
                  name={isRln ? 'cube' : 'flash'}
                  size={14}
                  color={isRln ? theme.colors.primary[500] : theme.colors.warning[500]}
                />
                <Text
                  style={[
                    styles.typeBadgeText,
                    { color: isRln ? theme.colors.primary[500] : theme.colors.warning[500] },
                  ]}
                >
                  {isRln ? 'RGB Lightning Node' : 'Lightning wallet'}
                </Text>
              </View>
              <Text style={styles.connectedHint}>
                <Ionicons name="checkmark-circle" size={13} color={theme.colors.success[500]} /> Connected
              </Text>
            </View>

            <Text style={styles.connectedDesc}>
              {isRln
                ? 'Full RGB + Lightning: send/receive BTC and RGB assets through this node.'
                : 'This is now your Lightning wallet for sending and balances. RGB assets are not available on a plain Lightning wallet.'}
            </Text>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Balance</Text>
                <Text style={styles.statValue}>
                  {balanceSats !== null ? `${balanceSats.toLocaleString()} sats` : '—'}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Network</Text>
                <Text style={styles.statValue}>{info?.network ?? '—'}</Text>
              </View>
            </View>

            <Input
              label="Test: pay a Lightning invoice"
              placeholder="lnbc..."
              value={invoice}
              onChangeText={setInvoice}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              editable={!paying}
            />
            <Button
              title={paying ? 'Paying…' : 'Pay invoice'}
              onPress={handlePay}
              disabled={paying || !invoice.trim()}
              loading={paying}
            />
          </View>
        )}

        {saved && (
          <View style={styles.disconnect}>
            <Button title="Disconnect wallet" variant="secondary" onPress={handleDisconnect} />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  content: {
    padding: theme.spacing[6],
    gap: theme.spacing[4],
  },
  intro: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.normal),
  },
  inputActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginTop: -theme.spacing[2],
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary[50],
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  actionChipText: {
    color: theme.colors.primary[500],
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  card: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[4],
    gap: theme.spacing[4],
    marginTop: theme.spacing[2],
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 5,
    borderRadius: theme.borderRadius.full,
  },
  typeBadgeText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.bold,
  },
  connectedHint: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.success[500],
    fontWeight: theme.typography.fontWeight.semibold,
  },
  connectedDesc: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.normal),
    marginTop: -theme.spacing[2],
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing[4],
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
    marginBottom: theme.spacing[1],
  },
  statValue: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.bold,
  },
  disconnect: {
    marginTop: theme.spacing[6],
  },
});

export default NWCConnectScreen;
