import { BARK_ENABLED } from '../services/protocols/bark';
import { barkNetworkLabel } from '../services/BarkService';
import { toEngineProtocol } from '../utils/protocol-bridge'
// screens/SettingsScreen.tsx
import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Switch, Alert, Text, TouchableOpacity, BackHandler, Keyboard } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { NetworkIcon } from '../components/NetworkIcon';
import { NetworkBadge } from '../components/NetworkBadge';
import { RootState } from '../store';
import {
  setCurrency,
  setNodeType,
  setRemoteNodeUrl,
  setUnitPreference,
  selectDisplayDenomination,
  selectDisclosureLevel,
  setDisclosureLevel,
  setSoundEnabled,
  type DisplayDenomination,
} from '../store/slices/settingsSlice';
import { feedback } from '../utils/feedback';
import { OptionSheet, type SheetOption } from '../components/OptionSheet';
import { formatDenominatedAmount, useBitcoinPriceIn } from '../utils/bitcoinUnits';
import { loadBtcBalance, setActiveWallet } from '../store/slices/walletSlice';
import { Button, Input, MainHeader } from '../components';
import { useAppTheme } from '../theme/ThemeProvider';
import { PairingService, type DesktopPairing } from '../services/PairingService';
import DatabaseService from '../services/DatabaseService';
import SecurityService from '../services/SecurityService';
import { RevealMnemonicModal } from '../components/RevealMnemonicModal';
import { initializeProtocols, protocolManager } from '../services/protocols';
import { removeNwcCredential, WALLET_SERVICE_NWC_URI_KEY } from '../services/nwc/connectionStore';
import { clearNwcConnections } from '../store/slices/nostrSlice';
import {
  NETWORK_LABEL,
  PROTOCOL_DEFAULT_NETWORK,
  PROTOCOL_SUPPORTED_NETWORKS,
  PROTOCOL_TO_NETWORK_TYPE,
  buildDefaultNetworkConfig,
  buildNetworkConfig,
  resolveSparkNetwork,
  type ProtocolNetwork,
} from '../services/protocols/networkConfig';

interface Props {
  navigation: any;
}

type WalletProtocol = 'RGB' | 'SPARK' | 'ARKADE';
const WALLET_PROTOCOLS: readonly WalletProtocol[] = ['RGB', 'SPARK', 'ARKADE'];
const RGB_VIA_NWC = process.env.EXPO_PUBLIC_RGB_VIA_NWC !== '0';

// ---------------------------------------------------------------------------
// Reusable building blocks — consistent, fully-themed rows so nothing renders
// invisible on the dark surface.
// ---------------------------------------------------------------------------

const SectionLabel: React.FC<{ children: React.ReactNode; tone?: 'default' | 'danger' }> = ({ children, tone = 'default' }) => {
  const theme = useAppTheme(); const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text accessibilityRole="header" style={[styles.sectionLabel, tone === 'danger' && { color: theme.colors.error[500] }]}>{children}</Text>;
};

const Group: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useAppTheme(); const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={styles.group}>{children}</View>;
};

const Row: React.FC<{
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  first?: boolean;
}> = ({ icon, iconColor, label, description, value, onPress, right, first }) => {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const content = (
    <View style={[styles.row, !first && styles.rowDivider]}>
      {icon && (
        <View style={[styles.rowIcon, { backgroundColor: theme.colors.surface.secondary }]}>
          <Ionicons name={icon} size={18} color={iconColor ?? theme.colors.text.secondary} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description && <Text style={styles.rowDescription}>{description}</Text>}
      </View>
      {right ?? (
        <View style={styles.rowRight}>
          {value != null && <Text style={styles.rowValue}>{value}</Text>}
          {onPress && <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />}
        </View>
      )}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} activeOpacity={0.7} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
};

export default function SettingsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state: RootState) => state.settings);
  const nostrState = useAppSelector((state: RootState) => state.nostr);
  const selectedNwcConnection = (nostrState.nwcConnections ?? []).find(
    (connection) => connection.id === nostrState.selectedNwcConnectionId,
  );
  const disclosureLevel = useAppSelector(selectDisclosureLevel);
  const [settingsQuery, setSettingsQuery] = useState('');
  type SettingsPage = 'preferences' | 'security' | 'connections' | 'assistant' | 'advanced';
  const [page, setPage] = useState<SettingsPage | null>(null);
  const titles: Record<SettingsPage, string> = { preferences: 'Preferences', security: 'Security & backup', connections: 'Connections', assistant: 'Assistant', advanced: 'Advanced' };
  const sections = [
    { page: 'connections', terms: 'nostr profile relays keys identity' },
    ...(!RGB_VIA_NWC ? [{ page: 'advanced', terms: 'direct node connectivity url' }] : []),
    { page: 'assistant', terms: 'kaleidomind ai desktop model agent assistant personalize connection' },
    { page: 'connections', terms: 'wallet connection lightning nwc rgb node' },
    { page: 'security', terms: 'security backup view recovery phrase' },
    { page: 'preferences', terms: 'preferences display detail mode bitcoin balance unit sound sounds payment currency fiat' },
    { page: 'advanced', terms: 'advanced accounts wallet protocols network spark arkade rgb bark' },
    { page: 'security', terms: 'danger remove delete wallet' },
  ];
  const query = settingsQuery.trim().toLowerCase();
  const showSection = (terms: string) => query
    ? query.split(/\s+/).every(word => terms.includes(word))
    : sections.find(section => section.terms === terms)?.page === page;
  const hasSettingsSearchResults = !query || sections.some(section => showSection(section.terms));
  const atHome = page === null && !query;
  const openPage = (next: SettingsPage) => { Keyboard.dismiss(); setSettingsQuery(''); setPage(next); };
  const goBack = useCallback(() => {
    if (settingsQuery) { setSettingsQuery(''); Keyboard.dismiss(); }
    else if (page) setPage(null);
    else navigation.goBack();
  }, [settingsQuery, page, navigation]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!page && !settingsQuery) return false;
      goBack(); return true;
    });
    return () => subscription.remove();
  }, [page, settingsQuery, goBack]));
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [tempNodeUrl, setTempNodeUrl] = useState(settings.remoteNodeUrl);

  // Per-protocol network (read from / written to the wallet's DB config).
  const activeWallet = useAppSelector((state: RootState) => state.wallet?.activeWallet);
  const isWalletUnlocked = useAppSelector((state: RootState) => state.wallet?.isUnlocked);
  const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null);
  const [showRevealModal, setShowRevealModal] = useState(false);

  const handleRecoverMnemonic = async () => {
    const walletId = (activeWallet as any)?.id;
    if (!walletId) {
      Alert.alert('No wallet found', 'Create or restore a wallet before recovering a recovery phrase.');
      return;
    }
    if (!isWalletUnlocked) {
      Alert.alert('Unlock wallet first', 'Unlock your wallet before recovering the recovery phrase.');
      return;
    }

    try {
      const mnemonic = await SecurityService.getInstance().revealMnemonic(walletId);
      if (mnemonic === null) return;
      if (!mnemonic) {
        Alert.alert('Unavailable', 'No recovery phrase is stored for this wallet on this device.');
        return;
      }
      setRevealedMnemonic(mnemonic);
      setShowRevealModal(true);
    } catch (e: any) {
      Alert.alert('Security required', e?.message || 'Could not authenticate this device.');
    }
  };

  const closeRevealModal = () => {
    setShowRevealModal(false);
    setRevealedMnemonic(null);
  };

  const [protoNetworks, setProtoNetworks] = useState<Record<string, string>>({});
  const [protocolStatus, setProtocolStatus] = useState<Record<WalletProtocol, boolean>>({
    RGB: false,
    SPARK: false,
    ARKADE: false,
  });
  const [protocolConnecting, setProtocolConnecting] = useState<Partial<Record<WalletProtocol, boolean>>>({});
  const [protocolErrors, setProtocolErrors] = useState<Partial<Record<WalletProtocol, string>>>({});
  const refreshProtocolStatus = useCallback(() => {
    setProtocolStatus({
      RGB: protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected() ?? false,
      SPARK: protocolManager.getAdapterIfAvailable('SPARK')?.isConnected() ?? false,
      ARKADE: protocolManager.getAdapterIfAvailable('ARKADE')?.isConnected() ?? false,
    });
  }, []);

  useEffect(() => {
    refreshProtocolStatus();
    const unsubscribe = navigation.addListener?.('focus', refreshProtocolStatus);
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [navigation, refreshProtocolStatus]);

  useEffect(() => {
    (async () => {
      const id = (activeWallet as any)?.id;
      if (!id) return;
      try {
        const nets = await DatabaseService.getInstance().getWalletNetworks(id);
        const map: Record<string, string> = {};
        for (const n of nets) {
          let net = PROTOCOL_DEFAULT_NETWORK[n.type] ?? 'regtest';
          try {
            if (n.config) net = JSON.parse(n.config).network || net;
          } catch { /* keep default */ }
          if (n.type === 'spark') net = resolveSparkNetwork(net);
          map[n.type] = net;
        }
        setProtoNetworks(map);
      } catch { /* ignore */ }
    })();
  }, [activeWallet]);

  const changeProtocolNetwork = (proto: WalletProtocol, network: ProtocolNetwork) => {
    const id = (activeWallet as any)?.id;
    const type = PROTOCOL_TO_NETWORK_TYPE[proto];
    if (!id) return;
    (async () => {
      setProtocolConnecting((prev) => ({ ...prev, [proto]: true }));
      setProtocolErrors((prev) => ({ ...prev, [proto]: undefined }));
      try {
        const db = DatabaseService.getInstance();
        const nets = await db.getWalletNetworks(id);
        const existing = nets.find((n) => n.type === type);
        const cfg = existing?.config ? JSON.parse(existing.config) : JSON.parse(buildDefaultNetworkConfig(type));
        const nextConfig = buildNetworkConfig(type, network, cfg);
        const effectiveNetwork = JSON.parse(nextConfig).network as ProtocolNetwork;
        if (existing) {
          await db.updateNetworkConfig(id, type, { enabled: true, config: nextConfig });
        } else {
          await db.addNetworkToWallet(id, { type, enabled: true, config: nextConfig });
        }

        await protocolManager.disconnect(toEngineProtocol(proto));
        const refreshedWallet = await db.getActiveWallet();
        const updatedNetwork = refreshedWallet?.networks?.find((n) => n.type === type);
        const mnemonic = refreshedWallet?.encrypted_mnemonic;
        if (!updatedNetwork || !mnemonic) {
          throw new Error('Wallet seed or network config is unavailable.');
        }

        const results = await initializeProtocols(mnemonic, [updatedNetwork]);
        const result = results.get(toEngineProtocol(proto));
        if (!result?.success) {
          throw new Error(result?.error || `${proto} did not connect.`);
        }

        if (refreshedWallet) dispatch(setActiveWallet(refreshedWallet));
        setProtoNetworks((prev) => ({ ...prev, [type]: effectiveNetwork }));
        refreshProtocolStatus();
        dispatch(loadBtcBalance() as any);
        Alert.alert(
          'Network connected',
          `${proto} is now connected on ${NETWORK_LABEL[effectiveNetwork] ?? effectiveNetwork}.`,
        );
      } catch (e: any) {
        refreshProtocolStatus();
        const effectiveNetwork = type === 'spark' ? resolveSparkNetwork(network) : network;
        setProtoNetworks((prev) => ({ ...prev, [type]: effectiveNetwork }));
        setProtocolErrors((prev) => ({ ...prev, [proto]: e?.message ?? 'Connection failed' }));
        Alert.alert('Network saved, connection failed', e?.message ?? 'Please try again.');
      } finally {
        setProtocolConnecting((prev) => ({ ...prev, [proto]: false }));
      }
    })();
  };

  const pickProtocolNetwork = (proto: WalletProtocol) => {
    const type = PROTOCOL_TO_NETWORK_TYPE[proto];
    const current = (protoNetworks[type] ?? PROTOCOL_DEFAULT_NETWORK[type]) as ProtocolNetwork;
    const connected = protocolStatus[proto];
    const options = PROTOCOL_SUPPORTED_NETWORKS[proto];
    Alert.alert(
      `${proto} network`,
      `Currently ${NETWORK_LABEL[current] ?? current}. Choose a network:`,
      [
        ...options.map((n) => ({
          text: `${NETWORK_LABEL[n] ?? n}${n === current ? '  ✓' : ''}`,
          onPress: () => {
            if (n !== current || !connected) changeProtocolNetwork(proto, n);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  // KaleidoMind — active desktop pairing (refreshed on focus)
  const [activePairing, setActivePairing] = useState<DesktopPairing | null>(null);
  useEffect(() => {
    const refresh = async () => {
      try {
        setActivePairing(await PairingService.getActive());
      } catch {
        setActivePairing(null);
      }
    };
    refresh();
    const unsubscribe = navigation.addListener?.('focus', refresh);
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [navigation]);

  const handleNodeTypeChange = async (useRemoteNode: boolean) => {
    const newType = useRemoteNode ? 'remote' : 'local';
    try {
      dispatch(setNodeType(newType));
      Alert.alert(
        'Node Type Changed',
        `Switched to ${newType} node. You may need to restart the app for changes to take effect.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Failed to change node type:', error);
      Alert.alert('Error', 'Failed to change node type. Please try again.');
    }
  };

  const handleNodeUrlSave = () => {
    if (!tempNodeUrl.trim()) {
      Alert.alert('Error', 'Please enter a valid node URL');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(tempNodeUrl);
      dispatch(setRemoteNodeUrl(tempNodeUrl));
      setIsEditingUrl(false);
      Alert.alert(
        'Node URL Updated',
        'The remote node URL has been updated. You may need to restart the app for changes to take effect.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert('Error', 'Please enter a valid URL (e.g., https://example.com:3000)');
    }
  };

  const displayDenomination = useAppSelector(selectDisplayDenomination);
  const denominationLabel: Record<DisplayDenomination, string> = {
    sats: 'Sats',
    BTC: 'BTC',
    fiat: settings.currency,
  };

  // Which settings selector sheet is open (one bottom sheet at a time).
  const [activeSheet, setActiveSheet] = useState<null | 'unit' | 'currency' | 'display'>(null);
  const btcPrice = useBitcoinPriceIn(settings.currency);

  // Live previews for the unit selector (sample = 1,234,567 sats), matching
  // exactly how balances render elsewhere in the app.
  const PREVIEW_SATS = 1234567;
  const unitPreview = (d: DisplayDenomination): string => {
    const f = formatDenominatedAmount(PREVIEW_SATS, {
      denomination: d,
      currency: settings.currency,
      price: btcPrice,
    });
    return d === 'fiat' ? f.primary : `${f.primary} ${f.unitLabel}`;
  };
  const unitOptions: SheetOption[] = [
    { id: 'sats', label: 'Satoshis', description: 'Show balances in sats', preview: unitPreview('sats'), badge: 'Default' },
    { id: 'BTC', label: 'Bitcoin (BTC)', description: '8-decimal bitcoin', preview: unitPreview('BTC') },
    { id: 'fiat', label: `Local currency (${settings.currency})`, description: 'Show values in fiat', preview: btcPrice ? unitPreview('fiat') : '—' },
  ];
  const currencyOptions: SheetOption[] = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'JPY'].map((c) => ({ id: c, label: c }));
  const displayModeOptions: SheetOption[] = [
    { id: 'lite', label: 'Lite', description: 'BTC, USD & assets only' },
    { id: 'advanced', label: 'Advanced', description: 'Networks, routes & channels' },
  ];

  // soundEnabled may be undefined in state persisted before this setting existed.
  const soundOn = settings.soundEnabled ?? true;
  const handleSoundToggle = (value: boolean) => {
    dispatch(setSoundEnabled(value));
    // Play a confirming chime when turning sound ON so the change is audible.
    if (value) feedback.success();
  };

  const handleRemoveWallet = () => {
    Alert.alert(
      'Remove Wallet',
      'This will delete your wallet data from this device. Make sure you have backed up your mnemonic phrase before proceeding.\n\nThis action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Wallet',
          style: 'destructive',
          onPress: async () => {
            try {
              const { protocolManager } = require('../services/protocols');
              await protocolManager.disconnectAll();
              const DBService = require('../services/DatabaseService').default;
              const db = DBService.getInstance();
              const aw = await db.getActiveWallet();
              if (aw?.id) await db.deleteWallet(aw.id);
              await Promise.all([
                ...(nostrState.nwcConnections ?? []).map((connection) => removeNwcCredential(connection.id)),
                SecureStore.deleteItemAsync(WALLET_SERVICE_NWC_URI_KEY),
              ]);
              dispatch(clearNwcConnections());
              dispatch(setActiveWallet(null as any));
              Alert.alert('Wallet Removed', 'You can now create or import a new wallet.');
              navigation.reset({ index: 0, routes: [{ name: 'InitialLoad' as any }] });
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to remove wallet');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <MainHeader title={query ? 'Search settings' : page ? titles[page] : 'Settings'} onBack={goBack} />
      <ScrollView key={page ?? 'home'} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {!page && <Input
          value={settingsQuery}
          onChangeText={setSettingsQuery}
          placeholder="Search settings"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search settings"
          leftIcon={<Ionicons name="search-outline" size={19} color={theme.colors.text.tertiary} />}
          rightIcon={settingsQuery ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSettingsQuery('')} style={styles.clearSearch}><Ionicons name="close-circle" size={20} color={theme.colors.text.tertiary} /></TouchableOpacity> : undefined}
        />}

        {atHome && <>
          <View style={styles.walletSummary}>
            <View style={styles.walletIcon}><Ionicons name="wallet-outline" size={24} color={theme.colors.primary[500]} /></View>
            <View style={styles.rowText}>
              <Text style={styles.rowDescription}>Current wallet</Text>
              <Text style={styles.walletName}>{activeWallet?.name || 'Your wallet'}</Text>
            </View>
          </View>
          <SectionLabel>Your wallet</SectionLabel>
          <Group>
            <Row first icon="options-outline" label="Preferences" description="Units, currency and sounds" value={denominationLabel[displayDenomination]} onPress={() => openPage('preferences')} />
            <Row icon="shield-checkmark-outline" label="Security & backup" description="Recovery phrase and device data" onPress={() => openPage('security')} />
            <Row icon="link-outline" label="Connections" description="Lightning wallets and Nostr" onPress={() => openPage('connections')} />
          </Group>
          <SectionLabel>More</SectionLabel>
          <Group>
            <Row first icon="sparkles-outline" label="Assistant" description="Desktop pairing and your AI preferences" onPress={() => openPage('assistant')} />
            <Row icon="code-slash-outline" label="Advanced" description="Accounts and network configuration" onPress={() => openPage('advanced')} />
            {__DEV__ && <Row icon="color-palette-outline" label="Component preview" description="Review shared mobile components" onPress={() => navigation.navigate('DesignSystem')} />}
          </Group>
        </>}
        {page === 'advanced' && <Text style={styles.pageDescription}>Manage the networks used by your wallet accounts. Test networks use separate test funds.</Text>}
        {page === 'security' && <Text style={styles.pageDescription}>Keep your recovery phrase private. It gives access to your funds.</Text>}


        {!hasSettingsSearchResults && (
          <View style={styles.searchEmpty} accessibilityRole="text">
            <Ionicons name="search-outline" size={24} color={theme.colors.text.tertiary} />
            <Text style={styles.searchEmptyTitle}>No settings found</Text>
            <Text style={styles.searchEmptyText}>Try “wallet”, “security”, “network”, or “display”.</Text>
          </View>
        )}

        {/* Nostr */}
        {showSection('nostr profile relays keys identity') && <>
        <SectionLabel>Nostr</SectionLabel>
        <Group>
          <Row
            first
            icon="planet"
            iconColor={theme.colors.primary[500]}
            label="Profile, relays &amp; keys"
            description={nostrState.isConnected ? 'Connected to relays' : 'Not connected'}
            right={
              <View style={styles.rowRight}>
                <View style={[styles.statusPill, { backgroundColor: (nostrState.isConnected ? theme.colors.success[500] : theme.colors.gray[400]) + '22' }]}>
                  <View style={[styles.statusDot, { backgroundColor: nostrState.isConnected ? theme.colors.success[500] : theme.colors.gray[400] }]} />
                  <Text style={[styles.statusPillText, { color: nostrState.isConnected ? theme.colors.success[500] : theme.colors.text.tertiary }]}>
                    {nostrState.isConnected ? 'On' : 'Off'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
              </View>
            }
            onPress={() => navigation.navigate('NostrSettings')}
          />
        </Group>
        </>}

        {/* The HTTP node controls are a legacy/developer transport. Mobile uses
            NWC by default, where showing this switch was misleading because it
            had no effect on the active adapter. */}
        {!RGB_VIA_NWC && showSection('direct node connectivity url') && (
          <>
          <SectionLabel>Direct node</SectionLabel>
          <Group>
          <Row
            first
            icon="server-outline"
            label="Use Remote Node"
            description="Connect to a remote RGB Lightning node"
            right={
              <Switch
                value={settings.nodeType === 'remote'}
                onValueChange={handleNodeTypeChange}
                trackColor={{ true: theme.colors.primary[500], false: theme.colors.gray[300] }}
              />
            }
          />
          {settings.nodeType === 'remote' && (
            <View style={styles.nodeUrlBlock}>
              <Text style={styles.rowLabel}>Node URL</Text>
              {isEditingUrl ? (
                <>
                  <Input
                    value={tempNodeUrl}
                    onChangeText={setTempNodeUrl}
                    placeholder="https://example.com:3000"
                    style={{ marginVertical: theme.spacing[2] }}
                  />
                  <View style={styles.urlButtons}>
                    <Button title="Cancel" variant="secondary" onPress={() => { setTempNodeUrl(settings.remoteNodeUrl); setIsEditingUrl(false); }} style={{ flex: 1 }} />
                    <Button title="Save" onPress={handleNodeUrlSave} style={{ flex: 1 }} />
                  </View>
                </>
              ) : (
                <View style={styles.urlView}>
                  <Text style={styles.urlText} numberOfLines={1}>{settings.remoteNodeUrl || 'Not set'}</Text>
                  <TouchableOpacity onPress={() => setIsEditingUrl(true)} style={styles.editChip}>
                    <Text style={styles.editChipText}>Edit</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          </Group>
          </>
        )}

        {/* KaleidoMind */}
        {showSection('kaleidomind ai desktop model agent assistant personalize connection') && <>
        <SectionLabel>KaleidoMind</SectionLabel>
        <Group>
          <Row
            first
            icon="sparkles-outline"
            iconColor={theme.colors.accent[500]}
            label="Desktop connection"
            description={activePairing ? 'Paired' : 'Run AI on your desktop'}
            value={activePairing ? activePairing.name : 'Connect'}
            onPress={() => navigation.navigate('PairDesktop')}
          />
          {activePairing && (
            <Row icon="cube-outline" iconColor={theme.colors.accent[500]} label="Active model" value={activePairing.model} />
          )}
          <Row
            icon="construct-outline"
            iconColor={theme.colors.accent[500]}
            label="Personalize assistant"
            description="Personality, memory and responses"
            onPress={() => navigation.navigate('MindSettings')}
          />
        </Group>
        </>}

        {showSection('wallet connection lightning nwc rgb node') && <>
        <SectionLabel>Wallet connection</SectionLabel>
        <Group>
          <Row
            first
            icon="flash-outline"
            iconColor={theme.colors.warning[500]}
            label="Lightning node"
            description={nostrState.connectedWallet
              ? nostrState.nwcWalletType === 'rln'
                ? `${selectedNwcConnection?.alias || 'RGB node'} · RGB, Lightning and channels`
                : `${selectedNwcConnection?.alias || 'NWC wallet'} · ${nostrState.nwcCapabilities?.includes('createInvoice') ? 'send and receive' : 'limited permissions'}`
              : 'Connect any NWC wallet or RGB Lightning node'}
            value={
              nostrState.connectedWallet
                ? nostrState.nwcWalletType === 'rln'
                  ? 'RGB node'
                  : 'Connected'
                : undefined
            }
            onPress={() => navigation.navigate('NWCConnect')}
          />
        </Group>
        </>}

        {/* Security */}
        {showSection('security backup view recovery phrase') && <>
        <SectionLabel>Security</SectionLabel>
        <Group>
          <Row
            first
            icon="key-outline"
            iconColor={theme.colors.warning[500]}
            label="View recovery phrase"
            description="Authenticate to view your backup"
            value={isWalletUnlocked ? 'Unlocked' : 'Locked'}
            onPress={handleRecoverMnemonic}
          />
        </Group>
        </>}

        {/* Preferences */}
        {showSection('preferences display detail mode bitcoin balance unit sound sounds payment currency fiat') && <>
        <SectionLabel>Preferences</SectionLabel>
        <Group>
          <Row first icon="options-outline" label="Display detail" description="How much detail the app shows" value={disclosureLevel === 'lite' ? 'Lite' : 'Advanced'} onPress={() => setActiveSheet('display')} />
          <Row icon="logo-bitcoin" iconColor={theme.colors.warning[500]} label="Balance unit" description="Sats, BTC or local currency" value={denominationLabel[displayDenomination]} onPress={() => setActiveSheet('unit')} />
          {/* Theme picker intentionally omitted: the app is dark-only for now —
              screens import the static dark theme, so a Light/System toggle had
              no visible effect. Re-add once screens consume useAppTheme(). */}
          <Row
            icon="volume-high-outline"
            iconColor={theme.colors.accent[500]}
            label="Payment sounds"
            description="Play sounds for wallet actions"
            right={
              <Switch
                accessibilityLabel="Payment sounds"
                value={soundOn}
                onValueChange={handleSoundToggle}
                trackColor={{ true: theme.colors.primary[500], false: theme.colors.gray[300] }}
              />
            }
          />
          <Row icon="cash-outline" iconColor={theme.colors.success[500]} label="Currency" description="Used for fiat estimates" value={settings.currency} onPress={() => setActiveSheet('currency')} />
        </Group>
        </>}

        {/* Network changes live in the explicit Advanced section in both display modes. */}
        {showSection('advanced accounts wallet protocols network spark arkade rgb bark') && (
          <>
          <SectionLabel>Accounts & networks</SectionLabel>
          {BARK_ENABLED && <Group><Row first icon="leaf-outline" label="Bark" description={`Second Ark · ${barkNetworkLabel()}`} value="Account" onPress={() => navigation.navigate('Bark')} /></Group>}
          <Group>
          {WALLET_PROTOCOLS.map((proto, idx) => {
            const connected = protocolStatus[proto];
            const connecting = protocolConnecting[proto] ?? false;
            const error = protocolErrors[proto];
            // RGB-Lightning uses the brand green accent (primary[500] === #2BEE79);
            // Spark maps to accent[400] (=== #60A5FA). Arkade's purple has no exact
            // token equivalent (brand.violet differs), so it stays a literal.
            const colors: Record<string, string> = {
              RGB: theme.colors.primary[500],
              SPARK: theme.colors.networks.spark,
              ARKADE: theme.colors.networks.arkade,
            };
            const labels: Record<string, string> = { RGB: 'RGB Lightning', SPARK: 'Spark', ARKADE: 'Arkade' };
            const descs: Record<string, string> = {
              RGB: 'On-chain, Lightning, RGB assets',
              SPARK: 'Spark L2 Bitcoin + tokens',
              ARKADE: 'Off-chain Bitcoin (VTXOs)',
            };
            return (
              <View key={proto} style={[styles.row, idx > 0 && styles.rowDivider]}>
                <View style={[styles.rowIcon, { backgroundColor: colors[proto] + '1A', opacity: connected ? 1 : 0.5 }]}>
                  <NetworkIcon network={proto} size={18} color={colors[proto]} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{labels[proto]}</Text>
                  <Text style={styles.rowDescription} numberOfLines={1}>{descs[proto]}</Text>
                  {!!error && !connecting && (
                    <Text style={[styles.rowDescription, { color: theme.colors.error[500] }]} numberOfLines={1}>
                      {error}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end', gap: theme.spacing[1] }}>
                  <NetworkBadge
                    network={protoNetworks[PROTOCOL_TO_NETWORK_TYPE[proto]] ?? PROTOCOL_DEFAULT_NETWORK[PROTOCOL_TO_NETWORK_TYPE[proto]]}
                    interactive
                    onPress={() => !connecting && pickProtocolNetwork(proto)}
                    accessibilityLabel={`Change ${proto} network`}
                  />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: connected ? colors[proto] : theme.colors.text.tertiary }}>
                    {connecting ? 'Connecting...' : connected ? 'Connected' : error ? 'Error' : 'Offline'}
                  </Text>
                </View>
              </View>
            );
          })}
          </Group>
          </>
        )}

        {/* Remove from this device */}
        {showSection('danger remove delete wallet') && <>
        <SectionLabel tone="danger">Remove from this device</SectionLabel>
        <Group>
          <TouchableOpacity activeOpacity={0.7} onPress={handleRemoveWallet}>
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: theme.colors.error[500] + '1A' }]}>
                <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: theme.colors.error[500] }]}>Remove Wallet</Text>
                <Text style={styles.rowDescription}>Requires your backup to restore later</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.error[500]} />
            </View>
          </TouchableOpacity>
        </Group>
        </>}

        <View style={{ height: theme.spacing[10] }} />
      </ScrollView>

      {/* Settings selectors */}
      <OptionSheet
        visible={activeSheet === 'unit'}
        title="Balance unit"
        options={unitOptions}
        selectedId={displayDenomination}
        onSelect={(id) => dispatch(setUnitPreference(id as DisplayDenomination))}
        onClose={() => setActiveSheet(null)}
      />
      <OptionSheet
        visible={activeSheet === 'currency'}
        title="Currency"
        options={currencyOptions}
        selectedId={settings.currency}
        onSelect={(id) => dispatch(setCurrency(id))}
        onClose={() => setActiveSheet(null)}
      />
      <OptionSheet
        visible={activeSheet === 'display'}
        title="Display detail"
        options={displayModeOptions}
        selectedId={disclosureLevel}
        onSelect={(id) => dispatch(setDisclosureLevel(id as any))}
        onClose={() => setActiveSheet(null)}
      />
      <RevealMnemonicModal
        visible={showRevealModal}
        mnemonic={revealedMnemonic}
        onClose={closeRevealModal}
      />
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  clearSearch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  walletSummary: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[5] },
  walletIcon: { width: 48, height: 48, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' },
  walletName: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.lg, fontWeight: '600', marginTop: theme.spacing[1] },
  pageDescription: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, paddingTop: theme.spacing[4], lineHeight: 21 },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
  },
  searchInput: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[1],
  },
  searchEmpty: {
    alignItems: 'center',
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  searchEmptyTitle: {
    marginTop: theme.spacing[2],
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  searchEmptyText: {
    marginTop: theme.spacing[1],
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: theme.spacing[5],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  group: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
    minHeight: 68,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  rowDescription: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    marginTop: 2,
  },
  rowRight: {
    maxWidth: '35%',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  rowValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    flexShrink: 1,
    textAlign: 'right',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
    borderRadius: theme.borderRadius.full,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  nostrContent: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
  },
  nwcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
    gap: theme.spacing[3],
  },
  nodeUrlBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
    paddingTop: theme.spacing[3],
  },
  urlButtons: {
    flexDirection: 'row',
    gap: theme.spacing[2],
  },
  urlView: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  urlText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  editChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.primary[50],
  },
  editChipText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[500],
  },
});
