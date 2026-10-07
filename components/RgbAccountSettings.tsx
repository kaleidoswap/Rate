// components/RgbAccountSettings.tsx
//
// Settings › RGB: where this wallet's RGB assets live. Two options, one in use
// at a time — RGB on this phone (rgb-lib, on-chain, no node) or your own RGB
// Lightning Node over Nostr Wallet Connect (Lightning, channels and swaps).
// A status header says which one is in use; a segmented choice shows each.
// RGB on this phone is set up right here; the node has its own screen.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import DatabaseService from '../services/DatabaseService';
import { protocolManager } from '../services/protocols';
import { RGB_L1_ENABLED, RGB_L1_NETWORK_LABEL, loadRgbL1Network, type RgbL1Network } from '../services/protocols/rgbL1';
import { rgbNetworkLabel } from '../services/protocols/rgbAccount';
import { Badge } from './Badge';
import { Button } from './Button';
import { SegmentedTabs } from './SegmentedTabs';
import { RgbIcon } from './ProtocolIcons';
import { RgbNodeIcon } from './RgbNodeIcon';
import { RgbOnDeviceSettings } from './RgbOnDeviceSettings';

export interface RgbNodeSummary {
  /** An RGB Lightning Node is connected (a plain Lightning wallet doesn't count). */
  connected: boolean;
  alias?: string;
  network?: string;
}

/** Status words shared by the Accounts row, this hub and the node screen. */
export const RGB_STATUS = { connected: 'Connected', notConnected: 'Not connected' } as const;

type Place = 'phone' | 'node';

export function RgbAccountSettings({ walletId, node, onOpenNode, onChanged }: {
  walletId: number;
  node: RgbNodeSummary;
  /** Opens the RGB Lightning Node screen (how to connect, connect, manage). */
  onOpenNode: () => void;
  onChanged?: () => void;
}) {
  const [phoneNetwork, setPhoneNetwork] = useState<RgbL1Network | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [place, setPlace] = useState<Place>(node.connected || !RGB_L1_ENABLED ? 'node' : 'phone');
  useEffect(() => { if (node.connected) setPlace('node'); }, [node.connected]);

  const refresh = useCallback(async () => {
    setPhoneConnected(!!protocolManager.getAdapterIfAvailable('RGB_L1')?.isConnected());
    try {
      const wallet = await DatabaseService.getInstance().getActiveWallet();
      setPhoneNetwork(wallet?.id === walletId && wallet.encrypted_mnemonic ? await loadRgbL1Network(wallet.encrypted_mnemonic) : null);
    } catch {
      setPhoneNetwork(null); // the panel below shows why
    }
  }, [walletId]);
  useEffect(() => { void refresh(); }, [refresh, node.connected]);

  const nodeNetwork = rgbNetworkLabel(node.network);
  const nodeName = [node.alias || 'Your node', nodeNetwork].filter(Boolean).join(' · ');
  const inUse: Place | null = node.connected ? 'node' : phoneConnected && RGB_L1_ENABLED ? 'phone' : null;
  const success = theme.colors.success[500];

  const statusTitle = inUse === 'node' ? 'On your RGB node' : inUse === 'phone' ? 'On this phone' : 'RGB assets';
  const statusMeta = inUse === 'node' ? nodeName
    : inUse === 'phone' && phoneNetwork ? `${RGB_L1_NETWORK_LABEL[phoneNetwork]} · beta`
    : phoneNetwork ? `This phone is set up for ${RGB_L1_NETWORK_LABEL[phoneNetwork]} but isn’t connected.`
    : 'Pick where your RGB assets live below.';

  return (
    <View style={styles.wrap}>
      <View accessibilityLabel={`RGB status: ${inUse ? RGB_STATUS.connected : RGB_STATUS.notConnected}`}
        style={[styles.card, styles.status, inUse && { borderColor: success + '66' }]}>
        <View style={[styles.statusIcon, { backgroundColor: theme.colors.background.secondary }]}>
          {inUse === 'node' ? <RgbNodeIcon size={28} /> : <RgbIcon size={28} />}
        </View>
        <View style={styles.text}>
          <Text style={styles.statusTitle}>{statusTitle}</Text>
          <Text style={styles.description} numberOfLines={2}>{statusMeta}</Text>
        </View>
        <Badge label={inUse ? RGB_STATUS.connected : RGB_STATUS.notConnected} tone={inUse ? 'success' : 'neutral'}
          icon={inUse ? 'checkmark-circle' : undefined} size="sm" />
      </View>

      <Text accessibilityRole="header" style={styles.sectionLabel}>Where your RGB assets live</Text>
      {RGB_L1_ENABLED && (
        <>
          <SegmentedTabs<Place> scrollable={false} fill value={place} onChange={setPlace}
            options={[
              { key: 'phone', label: 'This phone', icon: inUse === 'phone' ? 'checkmark-circle' : 'phone-portrait-outline' },
              { key: 'node', label: 'RGB node', ...(inUse === 'node' ? { icon: 'checkmark-circle' as const } : { renderIcon: (_c: string, size: number) => <RgbNodeIcon size={size} /> }) },
            ]} />
          <Text style={styles.hint}>
            {place === 'phone'
              ? 'On-chain RGB assets, no node needed. Beta.'
              : 'Your own node adds Lightning, channels and swaps. While connected, it replaces this phone.'}
          </Text>
        </>
      )}

      {place === 'phone' && RGB_L1_ENABLED ? (
        <View style={styles.card}>
          <RgbOnDeviceSettings walletId={walletId} nodeActive={node.connected} onOpenNode={onOpenNode}
            onChanged={() => { void refresh(); onChanged?.(); }} />
        </View>
      ) : (
        <View style={styles.card}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="RGB Lightning Node" accessibilityState={{ selected: node.connected }}
            onPress={onOpenNode} activeOpacity={0.7} style={styles.row}>
            <RgbNodeIcon size={28} />
            <View style={styles.text}>
              <Text style={styles.label}>RGB Lightning Node</Text>
              <Text style={styles.description} numberOfLines={2}>
                {node.connected ? nodeName : 'Remote, over Nostr Wallet Connect'}
              </Text>
            </View>
            <Badge label={node.connected ? RGB_STATUS.connected : RGB_STATUS.notConnected} tone={node.connected ? 'success' : 'neutral'} size="sm" />
            <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
          {!node.connected && (
            <View style={[styles.action, styles.divider]}>
              <Button title="Connect an RGB node" onPress={onOpenNode} fullWidth />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[3], marginBottom: theme.spacing[4] },
  card: {
    backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.xl,
    borderWidth: 1, borderColor: theme.colors.border.light, overflow: 'hidden',
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], padding: theme.spacing[4] },
  statusIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.text.primary },
  sectionLabel: {
    fontSize: theme.typography.fontSize.xs, fontWeight: '700', color: theme.colors.text.tertiary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: theme.spacing[2], marginLeft: theme.spacing[1],
  },
  hint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginLeft: theme.spacing[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 64, paddingVertical: theme.spacing[3] },
  action: { padding: theme.spacing[4] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  description: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
});
