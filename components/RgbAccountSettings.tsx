// components/RgbAccountSettings.tsx
//
// Settings › RGB: where this wallet's RGB assets live. Two options, one in use
// at a time — RGB on this phone (rgb-lib, on-chain, no node) or your own RGB
// Lightning Node over Nostr Wallet Connect (Lightning, channels and swaps).
// The summary stays visible while the selected settings group is open.
// RGB on this phone is set up right here; the node has its own screen.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { useAppLanguage } from '../localization/useAppLanguage';
import { RGB_L1_ENABLED, RGB_L1_NETWORK_LABEL } from '../services/protocols/rgbL1';
import { rgbNetworkLabel } from '../services/protocols/rgbAccount';
import { Badge } from './Badge';
import { SegmentedTabs } from './SegmentedTabs';
import { RgbIcon } from './ProtocolIcons';
import { RgbNodeIcon } from './RgbNodeIcon';
import { RgbOnDeviceSettings, type RgbDeviceSections } from './RgbOnDeviceSettings';
import { RgbWalletAssets } from './rgb/RgbWalletAssets';
import { RgbWalletTools } from './rgb/RgbWalletTools';
import { RgbValidationDetails } from './rgb/RgbValidationDetails';

export interface RgbNodeSummary {
  /** An RGB Lightning Node is connected (a plain Lightning wallet doesn't count). */
  connected: boolean;
  alias?: string;
  network?: string;
  relays?: string[];
  connectionId?: string;
  transport?: 'nwc' | 'http';
}

/** Status words shared by the Accounts row, this hub and the node screen. */
export const RGB_STATUS = { connected: 'Connected', notConnected: 'Not connected' } as const;

type Place = 'phone' | 'node';
type Section = 'backup' | 'assets' | 'advanced';

function SettingsCard({ title, icon, expanded, onPress, children }: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  expanded: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <TouchableOpacity accessible accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }}
        activeOpacity={0.7} onPress={onPress} style={styles.row}>
        <Ionicons name={icon} size={18} color={theme.colors.text.secondary} />
        <Text style={[styles.text, styles.label]}>{title}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.text.tertiary} />
      </TouchableOpacity>
      {expanded && <View style={styles.cardBody}>{children}</View>}
    </View>
  );
}

export function RgbAccountSettings({ walletId, node, onOpenNode, onChanged, allowNewPhoneSetup = true }: {
  walletId: number;
  node: RgbNodeSummary;
  allowNewPhoneSetup?: boolean;
  /** Opens the RGB Lightning Node screen (how to connect, connect, manage). */
  onOpenNode: () => void;
  onChanged?: () => void;
}) {
  const { t } = useAppLanguage();
  const [openSection, setOpenSection] = useState<Section | null>(null);
  const toggleSection = (section: Section) => setOpenSection(current => current === section ? null : section);
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const [preferredPlace, setPlace] = useState<Place>(node.connected || !RGB_L1_ENABLED ? 'node' : 'phone');
  useEffect(() => { if (node.connected) setPlace('node'); }, [node.connected]);

  const renderAccount = ({ backup, backupStatus, network, connected, enabledNetwork, connection, notice }: RgbDeviceSections) => {
    const showPhone = RGB_L1_ENABLED && (allowNewPhoneSetup || connected || !!enabledNetwork);
    const place = showPhone ? preferredPlace : 'node';
    const inUse: Place | null = node.connected ? 'node' : connected ? 'phone' : null;
    const inspectedPlace = inUse ?? place;
    const walletScope = inspectedPlace === 'phone'
      ? `phone/${walletId}/${enabledNetwork}`
      : `node/${walletId}/${node.connectionId}/${node.network}/${node.connected}`;
    const nodeMode = node.connected || !showPhone;
    const summaryTitle = nodeMode ? (inUse ? 'On your RGB node' : 'RGB node') : (inUse ? 'On this phone' : 'This phone');
    const localNetwork = inUse === 'phone' ? (enabledNetwork ?? network) : network;
    const nodeNetwork = rgbNetworkLabel(node.network);
    const summaryMeta = nodeMode ? [node.alias, nodeNetwork ?? t('Network unavailable')].filter(Boolean).join(' · ')
      : localNetwork ? RGB_L1_NETWORK_LABEL[localNetwork] : t('Network unavailable');
    const backupLine = nodeMode ? t('Managed on the node') : backupStatus ??
      t(inUse === 'phone' ? 'Checking cloud backup…' : 'Backup status unavailable offline');
    return (
      <View style={styles.wrap}>
        <View style={[styles.card, inUse && { borderColor: theme.colors.success[500] + '66' }]} testID="rgb-account-summary">
          <View style={styles.status}>
            {nodeMode ? <RgbNodeIcon size={22} /> : <RgbIcon size={22} />}
            <View style={styles.text}>
              <Text style={styles.statusTitle}>{t(summaryTitle)}</Text>
              <Text style={styles.description}>{summaryMeta}</Text>
            </View>
            <View accessibilityLabel={`${t('RGB status')}: ${t(inUse ? RGB_STATUS.connected : RGB_STATUS.notConnected)}`}>
              <Badge label={t(inUse ? RGB_STATUS.connected : RGB_STATUS.notConnected)} tone={inUse ? 'success' : 'neutral'}
                icon={inUse ? 'checkmark-circle' : undefined} size="sm" />
            </View>
          </View>
          <View style={styles.backupStatus}>
            <Text style={styles.description}>{t('Backup')}</Text>
            <Text style={[styles.description, styles.backupValue]} accessibilityLiveRegion="polite">{backupLine}</Text>
          </View>
        </View>

        <SettingsCard title={t('Backup & recovery')} icon="cloud-upload-outline" expanded={openSection === 'backup'} onPress={() => toggleSection('backup')}>
          {nodeMode ? (
            <View style={styles.backupInfo}>
              <Text style={styles.label}>{t('Node backup')}</Text>
              <Text style={styles.description}>
                {t(node.connected
                  ? 'Back up RGB assets and Lightning channels on the machine running your node. Ask its operator for the latest backup.'
                  : 'When you use an RGB node, its operator manages backups of its assets and Lightning channels.')}
              </Text>
            </View>
          ) : backup}
        </SettingsCard>
        {notice}

        <SettingsCard title={t('Assets & UTXOs')} icon="layers-outline" expanded={openSection === 'assets'} onPress={() => toggleSection('assets')}>
          {inUse ? <React.Fragment key={`assets/${walletScope}`}>
            <RgbWalletTools onIssued={() => setInventoryRevision(value => value + 1)} />
            <RgbWalletAssets key={inventoryRevision} protocol={inUse === 'phone' ? 'RGB_L1' : 'RGB_LN'} walletId={walletId}
              network={inUse === 'phone' ? enabledNetwork ?? undefined : node.network} />
          </React.Fragment> : <Text style={[styles.description, styles.backupInfo]}>{t('Connect your RGB wallet to view its assets and UTXOs.')}</Text>}
        </SettingsCard>

        <SettingsCard title={t('Advanced')} icon="options-outline" expanded={openSection === 'advanced'} onPress={() => toggleSection('advanced')}>
          {showPhone && (
            <>
              <View style={styles.tabs}>
                <SegmentedTabs<Place> scrollable={false} fill value={place} onChange={setPlace}
                  options={[
                    { key: 'phone', label: t('This phone'), icon: inUse === 'phone' ? 'checkmark-circle' : 'phone-portrait-outline' },
                    { key: 'node', label: t('RGB node'), ...(inUse === 'node' ? { icon: 'checkmark-circle' as const } : { renderIcon: (_c: string, size: number) => <RgbNodeIcon size={size} /> }) },
                  ]} />
              </View>
              {place !== inUse && <Text style={styles.hint}>
                {t(place === 'phone'
                  ? 'On-chain assets use the wallet on this phone.'
                  : 'Connecting a node moves RGB operations to that node. Your on-device assets stay on this phone.')}
              </Text>}
            </>
          )}

          {place === 'phone' ? connection : (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t(node.connected ? 'Manage RGB node' : 'Connect an RGB node')}
              onPress={onOpenNode} activeOpacity={0.7} style={styles.row}>
              <RgbNodeIcon size={20} />
              <View style={styles.text}>
                <Text style={styles.label}>{t(node.connected ? 'Manage RGB node' : 'Connect an RGB node')}</Text>
                <Text style={styles.description} numberOfLines={2}>
                  {node.transport === 'http' ? 'HTTP RPC' : 'Nostr Wallet Connect'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          )}
          <RgbValidationDetails key={walletScope} onDevice={inspectedPlace === 'phone'} phoneNetwork={enabledNetwork ?? null} node={node} />
        </SettingsCard>
      </View>
    );
  };

  if (!RGB_L1_ENABLED) return renderAccount({});
  return (
    <RgbOnDeviceSettings key={walletId} walletId={walletId} nodeActive={node.connected} onOpenNode={onOpenNode}
      onChanged={onChanged}>
      {renderAccount}
    </RgbOnDeviceSettings>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[1.5], marginBottom: theme.spacing[3] },
  card: {
    backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.md,
    borderWidth: 1, borderColor: theme.colors.border.light, overflow: 'hidden',
  },
  cardBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  backupStatus: {
    flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing[2], borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light, paddingHorizontal: theme.spacing[2.5], paddingVertical: theme.spacing[1],
  },
  backupValue: { flex: 1, textAlign: 'right', color: theme.colors.text.primary },
  backupInfo: { paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2] },
  status: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], paddingHorizontal: theme.spacing[2.5], paddingVertical: theme.spacing[1.5] },
  statusTitle: { fontSize: theme.typography.fontSize.sm, fontWeight: '700', color: theme.colors.text.primary },
  tabs: { margin: theme.spacing[1.5] },
  hint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, paddingHorizontal: theme.spacing[2.5], paddingVertical: theme.spacing[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], paddingHorizontal: theme.spacing[2.5], minHeight: 44, paddingVertical: theme.spacing[1] },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.primary },
  description: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
});
