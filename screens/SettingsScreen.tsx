// screens/SettingsScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Switch, Alert, Text, TouchableOpacity } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { NetworkIcon } from '../components/NetworkIcon';
import { NetworkBadge } from '../components/NetworkBadge';
import { RootState } from '../store';
import {
  setTheme,
  setCurrency,
  setNodeType,
  setRemoteNodeUrl,
  setUnitPreference,
  selectDisplayDenomination,
  setDisclosureLevel,
  setSoundEnabled,
  selectDisclosureLevel,
  type DisplayDenomination,
} from '../store/slices/settingsSlice';
import { feedback } from '../utils/feedback';
import { OptionSheet, type SheetOption } from '../components/OptionSheet';
import { formatDenominatedAmount, useBitcoinPrice } from '../utils/bitcoinUnits';
import { setActiveWallet } from '../store/slices/walletSlice';
import { Button, Input, MainHeader } from '../components';
import { theme } from '../theme';
import { PairingService, type DesktopPairing } from '../services/PairingService';
import DatabaseService, { type NetworkType } from '../services/DatabaseService';

// Networks each protocol supports (mirrors the adapter network unions).
const PROTO_SUPPORTED_NETWORKS: Record<'RGB' | 'SPARK' | 'ARKADE', string[]> = {
  SPARK: ['regtest', 'testnet', 'signet', 'mainnet'],
  ARKADE: ['signet', 'mainnet'],
  RGB: ['regtest', 'testnet', 'signet'],
};
const PROTO_TO_NETWORK_TYPE: Record<'RGB' | 'SPARK' | 'ARKADE', NetworkType> = {
  RGB: 'rln',
  SPARK: 'spark',
  ARKADE: 'arkade',
};
const PROTO_DEFAULT_NETWORK: Record<string, string> = {
  spark: 'regtest',
  arkade: 'signet',
  rln: 'regtest',
  liquid: 'testnet',
};
const NETWORK_LABEL: Record<string, string> = {
  mainnet: 'Mainnet',
  testnet: 'Testnet',
  regtest: 'Regtest',
  signet: 'Mutinynet',
};

interface Props {
  navigation: any;
}

// ---------------------------------------------------------------------------
// Reusable building blocks — consistent, fully-themed rows so nothing renders
// invisible on the dark surface.
// ---------------------------------------------------------------------------

const SectionLabel: React.FC<{ children: React.ReactNode; tone?: 'default' | 'danger' }> = ({ children, tone = 'default' }) => (
  <Text style={[styles.sectionLabel, tone === 'danger' && { color: theme.colors.error[500] }]}>{children}</Text>
);

const Group: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.group}>{children}</View>
);

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
  const content = (
    <View style={[styles.row, !first && styles.rowDivider]}>
      {icon && (
        <View style={[styles.rowIcon, { backgroundColor: (iconColor ?? theme.colors.primary[500]) + '1A' }]}>
          <Ionicons name={icon} size={18} color={iconColor ?? theme.colors.primary[500]} />
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
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
};

export default function SettingsScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.settings);
  const nostrState = useSelector((state: RootState) => state.nostr);
  const disclosureLevel = useSelector(selectDisclosureLevel);
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [tempNodeUrl, setTempNodeUrl] = useState(settings.remoteNodeUrl);

  // Per-protocol network (read from / written to the wallet's DB config).
  const activeWallet = useSelector((state: RootState) => state.wallet?.activeWallet);
  const [protoNetworks, setProtoNetworks] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const id = (activeWallet as any)?.id;
      if (!id) return;
      try {
        const nets = await DatabaseService.getInstance().getWalletNetworks(id);
        const map: Record<string, string> = {};
        for (const n of nets) {
          let net = PROTO_DEFAULT_NETWORK[n.type] ?? 'regtest';
          try {
            if (n.config) net = JSON.parse(n.config).network || net;
          } catch { /* keep default */ }
          map[n.type] = net;
        }
        setProtoNetworks(map);
      } catch { /* ignore */ }
    })();
  }, [activeWallet]);

  const changeProtocolNetwork = (proto: 'RGB' | 'SPARK' | 'ARKADE', network: string) => {
    const id = (activeWallet as any)?.id;
    const type = PROTO_TO_NETWORK_TYPE[proto];
    if (!id) return;
    (async () => {
      try {
        const db = DatabaseService.getInstance();
        const nets = await db.getWalletNetworks(id);
        const existing = nets.find((n) => n.type === type);
        const cfg = existing?.config ? JSON.parse(existing.config) : {};
        cfg.network = network;
        await db.updateNetworkConfig(id, type, { config: JSON.stringify(cfg) });
        setProtoNetworks((prev) => ({ ...prev, [type]: network }));
        Alert.alert(
          'Network updated',
          `${proto} will connect on ${NETWORK_LABEL[network] ?? network} the next time you open the app.`,
        );
      } catch (e: any) {
        Alert.alert('Could not update network', e?.message ?? 'Please try again.');
      }
    })();
  };

  const pickProtocolNetwork = (proto: 'RGB' | 'SPARK' | 'ARKADE') => {
    const type = PROTO_TO_NETWORK_TYPE[proto];
    const current = protoNetworks[type] ?? PROTO_DEFAULT_NETWORK[type];
    const options = PROTO_SUPPORTED_NETWORKS[proto];
    Alert.alert(
      `${proto} network`,
      `Currently ${NETWORK_LABEL[current] ?? current}. Choose a network:`,
      [
        ...options.map((n) => ({
          text: `${NETWORK_LABEL[n] ?? n}${n === current ? '  ✓' : ''}`,
          onPress: () => n !== current && changeProtocolNetwork(proto, n),
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

  const displayDenomination = useSelector(selectDisplayDenomination);
  const denominationLabel: Record<DisplayDenomination, string> = {
    sats: 'Sats',
    BTC: 'BTC',
    fiat: settings.currency,
  };

  // Which settings selector sheet is open (one bottom sheet at a time).
  const [activeSheet, setActiveSheet] = useState<null | 'unit' | 'currency' | 'theme' | 'display'>(null);
  const btcPrice = useBitcoinPrice();

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
  const themeOptions: SheetOption[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
  ];
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

  const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  return (
    <View style={styles.container}>
      <MainHeader title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Nostr */}
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

        {/* Connectivity */}
        <SectionLabel>Connectivity</SectionLabel>
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

        {/* KaleidoMind */}
        <SectionLabel>KaleidoMind</SectionLabel>
        <Group>
          <Row
            first
            icon="sparkles-outline"
            iconColor={theme.colors.accent[500]}
            label="Desktop brain"
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
            label="Design your agent"
            description="Persona, responses, context, memory & knowledge"
            onPress={() => navigation.navigate('MindSettings')}
          />
        </Group>

        <SectionLabel>Connections</SectionLabel>
        <Group>
          <Row
            first
            icon="flash-outline"
            iconColor={theme.colors.warning[500]}
            label="Connect a Lightning wallet"
            description="Pay & check balances via NWC (Lightning or RGB node)"
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

        {/* Preferences */}
        <SectionLabel>Preferences</SectionLabel>
        <Group>
          <Row first icon="options-outline" label="Display Mode" description="How much detail the app shows" value={disclosureLevel === 'lite' ? 'Lite' : 'Advanced'} onPress={() => setActiveSheet('display')} />
          <Row icon="logo-bitcoin" iconColor={theme.colors.warning[500]} label="Bitcoin Unit" description="How balances &amp; amounts are shown" value={denominationLabel[displayDenomination]} onPress={() => setActiveSheet('unit')} />
          <Row icon="contrast-outline" label="Theme" value={capitalize(settings.theme)} onPress={() => setActiveSheet('theme')} />
          <Row
            icon="volume-high-outline"
            iconColor={theme.colors.accent[500]}
            label="Sound Effects"
            description="Audio cues paired with haptics for actions"
            right={
              <Switch
                value={soundOn}
                onValueChange={handleSoundToggle}
                trackColor={{ true: theme.colors.primary[500], false: theme.colors.gray[300] }}
              />
            }
          />
          <Row icon="cash-outline" iconColor={theme.colors.success[500]} label="Currency" description="Fiat used for value display" value={settings.currency} onPress={() => setActiveSheet('currency')} />
        </Group>

        {/* Wallet Protocols */}
        <SectionLabel>Wallet Protocols</SectionLabel>
        <Group>
          {(['RGB', 'SPARK', 'ARKADE'] as const).map((proto, idx) => {
            const { protocolManager: pm } = require('../services/protocols');
            const adapter = pm.getAdapterIfAvailable(proto);
            const connected = adapter?.isConnected() ?? false;
            const colors: Record<string, string> = { RGB: '#2BEE79', SPARK: '#60A5FA', ARKADE: '#A855F7' };
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
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <NetworkBadge
                    network={protoNetworks[PROTO_TO_NETWORK_TYPE[proto]] ?? PROTO_DEFAULT_NETWORK[PROTO_TO_NETWORK_TYPE[proto]]}
                    interactive
                    onPress={() => pickProtocolNetwork(proto)}
                    accessibilityLabel={`Change ${proto} network`}
                  />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: connected ? colors[proto] : theme.colors.text.tertiary }}>
                    {connected ? 'Connected' : 'Offline'}
                  </Text>
                </View>
              </View>
            );
          })}
        </Group>

        {/* Danger Zone */}
        <SectionLabel tone="danger">Danger Zone</SectionLabel>
        <Group>
          <TouchableOpacity activeOpacity={0.7} onPress={handleRemoveWallet}>
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: theme.colors.error[500] + '1A' }]}>
                <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: theme.colors.error[500] }]}>Remove Wallet</Text>
                <Text style={styles.rowDescription}>Delete wallet data and start fresh</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.error[500]} />
            </View>
          </TouchableOpacity>
        </Group>

        <View style={{ height: theme.spacing[10] }} />
      </ScrollView>

      {/* Settings selectors */}
      <OptionSheet
        visible={activeSheet === 'unit'}
        title="Bitcoin Unit"
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
        visible={activeSheet === 'theme'}
        title="Theme"
        options={themeOptions}
        selectedId={settings.theme}
        onSelect={(id) => dispatch(setTheme(id as 'light' | 'dark' | 'system'))}
        onClose={() => setActiveSheet(null)}
      />
      <OptionSheet
        visible={activeSheet === 'display'}
        title="Display Mode"
        options={displayModeOptions}
        selectedId={disclosureLevel}
        onSelect={(id) => dispatch(setDisclosureLevel(id as any))}
        onClose={() => setActiveSheet(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    minHeight: 60,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  rowValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[500],
    textTransform: 'capitalize',
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
