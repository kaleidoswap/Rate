// screens/NWCConnectScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity, Clipboard } from 'react-native';
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
  setNwcWalletType,
  upsertNwcConnection,
  selectNwcConnection,
  removeNwcConnection,
} from '../store/slices/nostrSlice';
import {
  NWCClient,
  parseNwcUri,
  type NwcGetInfoResult,
} from '../services/nwc/NWCExternalClient';
import {
  connectionIdForUri,
  deriveNwcCapabilities,
  friendlyNwcError,
  loadActiveNwcCredential,
  removeNwcCredential,
  saveAndSelectNwcCredential,
  saveNwcCredential,
  selectNwcCredential,
  type NwcCapability,
  type SavedNwcConnection,
} from '../services/nwc/connectionStore';

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
  const savedConnections = useSelector((s: RootState) => s.nostr?.nwcConnections ?? []);
  const selectedConnectionId = useSelector((s: RootState) => s.nostr?.selectedNwcConnectionId);

  const [connectionString, setConnectionString] = useState('');
  const [showConnectionString, setShowConnectionString] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<NwcGetInfoResult | null>(null);
  const [walletType, setWalletType] = useState<WalletType | null>(storedType ?? null);
  const [balanceSats, setBalanceSats] = useState<number | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

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
    async (
      uri: string,
      type: WalletType,
      network: string,
      walletPubkey: string,
      alias: string | undefined,
      capabilities: NwcCapability[],
      relays: string[],
    ) => {
      setLoading(true);
      setConnectionError(null);
      let id = '';
      let previous: { id: string | null; uri: string | null } = { id: null, uri: null };
      let previousMetadata: SavedNwcConnection | undefined;
      try {
        id = connectionIdForUri(uri);
        previous = await loadActiveNwcCredential();
        previousMetadata = savedConnections.find((connection) => connection.id === previous.id);
        // Force the shared adapter to reload its credential when replacing an
        // already-connected wallet; ProtocolManager otherwise may reuse it.
        await protocolManager.disconnect('RGB_LN').catch(() => undefined);
        // 1) Persist the credential only in SecureStore and select it for the
        // adapter. Redux receives display-safe metadata below.
        await saveAndSelectNwcCredential(id, uri);
        // 2) Enroll the network so it reconnects on launch.
        await enrollNetwork(network);
        // 3) Activate the adapter now.
        await protocolManager.connect('RGB_LN', { protocol: 'RGB_LN', network } as any);
        await protocolManager.setActiveProtocol('RGB_LN');
        // 4) Reflect in Redux + pull fresh balances/assets through the new wallet.
        dispatch(setConnectedWallet(walletPubkey));
        dispatch(setNwcWalletType(type));
        dispatch(upsertNwcConnection({
          id,
          walletPubkey,
          alias,
          network,
          type,
          capabilities,
          relays,
          lastConnectedAt: Date.now(),
        }));
        dispatch(loadBtcBalance() as any);
        if (activeWallet?.id) dispatch(syncAssets(activeWallet.id) as any);

        setSaved(true);
        // 5) Done — go to the wallet home.
        navigation.navigate('Dashboard');
      } catch (e) {
        // Keep connection selection transactional. If activation failed, put
        // the previous credential and adapter back instead of leaving SecureStore
        // and Redux pointing at different wallets.
        if (previous.id && previous.uri && previous.id !== id) {
          try {
            await saveAndSelectNwcCredential(previous.id, previous.uri);
            if (previousMetadata) {
              await enrollNetwork(previousMetadata.network);
              await protocolManager.connect('RGB_LN', {
                protocol: 'RGB_LN',
                network: previousMetadata.network,
              } as any);
            }
          } catch {
            // Preserve the original activation error for the user.
          }
        } else if (!previous.id && id) {
          await removeNwcCredential(id).catch(() => undefined);
        }
        setConnectionError(friendlyNwcError(e));
      } finally {
        setLoading(false);
      }
    },
    [dispatch, enrollNetwork, activeWallet?.id, navigation, savedConnections],
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
        const nodeInfo = await client.getInfo();
        let sats: number | null = null;
        try {
          const balance = await client.getBalance();
          sats = Math.floor(balance.balance / 1000);
        } catch {
          // Balance access is optional in NIP-47. A pay-only or receive-only
          // connection remains useful and is described by its capabilities.
        }

        let isRln = (nodeInfo.methods ?? []).some((m) => m.startsWith('rln_'));
        // Older RLN wallet services advertise only the standard NIP-47 method
        // list. Probe the harmless node-info extension before classifying them
        // as a plain Lightning wallet, matching NwcRgbAdapter.connect().
        if (!isRln) {
          try {
            const rlnInfo = await client.rlnNodeInfo();
            isRln = !!rlnInfo && typeof rlnInfo === 'object';
          } catch {
            // Expected for a normal NWC Lightning wallet.
          }
        }
        const type: WalletType = isRln ? 'rln' : 'ln';
        const detectedCapabilities = deriveNwcCapabilities(nodeInfo.methods ?? [], isRln);
        const network = nodeInfo.network || 'regtest';
        setInfo(nodeInfo);
        setWalletType(type);
        setBalanceSats(sats);
        setLoading(false); // probe done; finalize() manages its own loading

        const typeName = isRln ? 'RGB Lightning Node' : 'Lightning wallet';
        const capabilitySummary = isRln
          ? '• Send & receive Bitcoin (Lightning)\n• Send & receive RGB assets (USDT, XAUT…)'
          : '• Send & receive Bitcoin (Lightning)\n• RGB assets not supported on this wallet';
        Alert.alert(
          `Connect ${typeName}?`,
          `${nodeInfo.alias ? `${nodeInfo.alias}\n` : ''}${sats == null ? '' : `Balance: ${sats.toLocaleString()} sats · `}${network}\n\nThis wallet will be used to:\n${capabilitySummary}`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setLoading(false) },
            {
              text: 'Connect',
              onPress: () => finalize(
                uri,
                type,
                network,
                parsed!.walletPubkey,
                nodeInfo.alias,
                detectedCapabilities,
                parsed!.relays,
              ),
            },
          ],
        );
      } catch (e) {
        setLoading(false);
        setConnectionError(friendlyNwcError(e));
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
    loadActiveNwcCredential().then(async ({ id, uri }) => {
      if (!uri) return;
      setSaved(true);
      // Migrate the old single active credential into the per-connection slot.
      const migrationId = id ?? selectedConnectionId ?? savedConnections[0]?.id;
      if (migrationId) await saveNwcCredential(migrationId, uri);
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

  const handleDisconnect = async (connection?: SavedNwcConnection) => {
    const targetId = connection?.id ?? selectedConnectionId;
    if (!targetId) return;
    const wasSelected = targetId === selectedConnectionId;
    try {
      if (wasSelected) await protocolManager.disconnect('RGB_LN');
    } catch {
      /* ignore */
    }
    await removeNwcCredential(targetId);
    dispatch(removeNwcConnection(targetId));
    const fallback = savedConnections.find((item) => item.id !== targetId);
    if (wasSelected && fallback) {
      try {
        await selectNwcCredential(fallback.id);
        await enrollNetwork(fallback.network);
        await protocolManager.connect('RGB_LN', { protocol: 'RGB_LN', network: fallback.network } as any);
        dispatch(selectNwcConnection(fallback.id));
        setWalletType(fallback.type);
        setInfo({ alias: fallback.alias, network: fallback.network, methods: [] });
        setSaved(true);
        Alert.alert('Connection removed', `${fallback.alias || 'Another Lightning wallet'} is now active.`);
        return;
      } catch (error) {
        setConnectionError(friendlyNwcError(error));
      }
    }
    if (!wasSelected) {
      Alert.alert('Connection removed', 'The saved Lightning wallet was removed.');
      return;
    }
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
    if (wasSelected) {
      dispatch(selectNwcConnection(null));
    }
    setConnectionString('');
    setSaved(false);
    setInfo(null);
    setWalletType(null);
    setBalanceSats(null);
    Alert.alert('Disconnected', 'Lightning wallet removed');
  };

  const handleSelectConnection = async (connection: SavedNwcConnection) => {
    if (connection.id === selectedConnectionId || loading) return;
    setLoading(true);
    setConnectionError(null);
    const previous = savedConnections.find((item) => item.id === selectedConnectionId);
    try {
      await protocolManager.disconnect('RGB_LN').catch(() => undefined);
      await selectNwcCredential(connection.id);
      await enrollNetwork(connection.network);
      await protocolManager.connect('RGB_LN', { protocol: 'RGB_LN', network: connection.network } as any);
      dispatch(selectNwcConnection(connection.id));
      dispatch(loadBtcBalance() as any);
      setWalletType(connection.type);
      setInfo({ alias: connection.alias, network: connection.network, methods: [] });
      setBalanceSats(null);
      setSaved(true);
    } catch (error) {
      if (previous) {
        try {
          await selectNwcCredential(previous.id);
          await enrollNetwork(previous.network);
          await protocolManager.connect('RGB_LN', { protocol: 'RGB_LN', network: previous.network } as any);
          dispatch(selectNwcConnection(previous.id));
        } catch {
          // The actionable error below remains the primary failure.
        }
      }
      setConnectionError(friendlyNwcError(error));
    } finally {
      setLoading(false);
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
          multiline={showConnectionString}
          secureTextEntry={!showConnectionString}
          editable={!loading}
          accessibilityLabel="Nostr Wallet Connect connection string"
          rightIcon={(
            <TouchableOpacity
              onPress={() => setShowConnectionString((visible) => !visible)}
              accessibilityRole="button"
              accessibilityLabel={showConnectionString ? 'Hide connection string' : 'Show connection string'}
              hitSlop={8}
            >
              <Ionicons
                name={showConnectionString ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={theme.colors.text.tertiary}
              />
            </TouchableOpacity>
          )}
        />

        <View style={styles.inputActions}>
          <TouchableOpacity style={styles.actionChip} onPress={handlePaste} disabled={loading} accessibilityRole="button" accessibilityLabel="Paste NWC connection string">
            <Ionicons name="clipboard-outline" size={16} color={theme.colors.primary[500]} />
            <Text style={styles.actionChipText}>Paste</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={handleScan} disabled={loading} accessibilityRole="button" accessibilityLabel="Scan NWC QR code">
            <Ionicons name="qr-code-outline" size={16} color={theme.colors.primary[500]} />
            <Text style={styles.actionChipText}>Scan</Text>
          </TouchableOpacity>
        </View>

        <Button
          title={loading ? 'Connecting…' : 'Add wallet'}
          onPress={() => connect(connectionString.trim())}
          disabled={loading || !connectionString.trim()}
          loading={loading}
        />

        {connectionError && (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.colors.error[500]} />
            <Text style={styles.errorText}>{connectionError}</Text>
          </View>
        )}

        {savedConnections.length > 0 && (
          <View style={styles.savedSection}>
            <Text style={styles.sectionTitle}>Saved Lightning wallets</Text>
            {savedConnections.map((connection) => {
              const active = connection.id === selectedConnectionId;
              const rln = connection.type === 'rln';
              const accent = rln ? theme.colors.primary[500] : theme.colors.warning[500];
              return (
                <TouchableOpacity
                  key={connection.id}
                  style={[styles.card, active && { borderColor: accent }]}
                  onPress={() => handleSelectConnection(connection)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: loading }}
                  accessibilityLabel={`${connection.alias || (rln ? 'RGB Lightning Node' : 'Lightning wallet')}, ${connection.network}${active ? ', active' : ''}`}
                >
                  <View style={styles.typeRow}>
                    <View style={styles.walletIdentity}>
                      <View style={[styles.walletIcon, { backgroundColor: accent + '1A' }]}>
                        <Ionicons name={rln ? 'cube' : 'flash'} size={18} color={accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.walletName} numberOfLines={1}>
                          {connection.alias || (rln ? 'RGB Lightning Node' : 'Lightning wallet')}
                        </Text>
                        <Text style={styles.walletMeta}>{connection.network} · NWC</Text>
                      </View>
                    </View>
                    {active && (
                      <View style={styles.activePill}>
                        <View style={styles.activeDot} />
                        <Text style={styles.activeText}>Active</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.capabilities}>
                    {connection.capabilities.slice(0, 5).map((capability) => (
                      <View key={capability} style={styles.capabilityChip}>
                        <Text style={styles.capabilityText}>
                          {{
                            payInvoice: 'Pay',
                            createInvoice: 'Receive',
                            readBalance: 'Balance',
                            readHistory: 'History',
                            lookupInvoice: 'Status',
                            manageChannels: 'Channels',
                            rgbAssets: 'RGB',
                            onchain: 'On-chain',
                          }[capability]}
                        </Text>
                      </View>
                    ))}
                    {connection.capabilities.length > 5 && (
                      <View style={styles.capabilityChip}>
                        <Text style={styles.capabilityText}>+{connection.capabilities.length - 5}</Text>
                      </View>
                    )}
                  </View>

                  {active && balanceSats !== null && (
                    <Text style={styles.walletBalance}>{balanceSats.toLocaleString()} sats</Text>
                  )}

                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={(event) => {
                      event.stopPropagation();
                      handleDisconnect(connection);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${connection.alias || 'Lightning wallet'}`}
                  >
                    <Ionicons name="trash-outline" size={15} color={theme.colors.error[500]} />
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
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
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  savedSection: {
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.bold,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  walletIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  walletIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletName: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.bold,
  },
  walletMeta: {
    marginTop: 2,
    color: theme.colors.text.tertiary,
    fontSize: theme.typography.fontSize.xs,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.success[50],
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.success[500],
  },
  activeText: {
    color: theme.colors.success[500],
    fontSize: 10,
    fontWeight: '700',
  },
  capabilities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  capabilityChip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.secondary,
  },
  capabilityText: {
    color: theme.colors.text.secondary,
    fontSize: 10,
    fontWeight: '600',
  },
  walletBalance: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
  },
  removeButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: theme.spacing[1],
  },
  removeText: {
    color: theme.colors.error[500],
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.error[500] + '35',
    backgroundColor: theme.colors.error[50],
  },
  errorText: {
    flex: 1,
    color: theme.colors.error[500],
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 19,
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
