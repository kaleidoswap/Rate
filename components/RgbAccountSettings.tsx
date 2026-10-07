// components/RgbAccountSettings.tsx
//
// Settings › RGB: where this wallet's RGB assets live. Two options, one in use
// at a time — RGB on this phone (rgb-lib, on-chain, no node) or your own RGB
// Lightning Node over Nostr Wallet Connect (Lightning, channels and swaps).
// RGB on this phone is set up right here; the node has its own screen.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, protocolColor } from '../theme';
import DatabaseService from '../services/DatabaseService';
import { protocolManager } from '../services/protocols';
import { RGB_L1_ENABLED, RGB_L1_NETWORK_LABEL, loadRgbL1Network, type RgbL1Network } from '../services/protocols/rgbL1';
import { rgbNetworkLabel } from '../services/protocols/rgbAccount';
import { Badge } from './Badge';
import { RgbOnDeviceSettings } from './RgbOnDeviceSettings';

export interface RgbNodeSummary {
  /** An RGB Lightning Node is connected (a plain Lightning wallet doesn't count). */
  connected: boolean;
  alias?: string;
  network?: string;
}

export function RgbAccountSettings({ walletId, node, onOpenNode, onChanged }: {
  walletId: number;
  node: RgbNodeSummary;
  /** Opens the RGB Lightning Node screen (how to connect, connect, manage). */
  onOpenNode: () => void;
  onChanged?: () => void;
}) {
  const [phoneNetwork, setPhoneNetwork] = useState<RgbL1Network | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [open, setOpen] = useState(!node.connected);

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

  const color = protocolColor('RGB');
  const nodeNetwork = rgbNetworkLabel(node.network);
  const phoneStatus = node.connected
    ? (phoneNetwork ? 'Not in use' : null)
    : phoneConnected && phoneNetwork ? `In use · ${RGB_L1_NETWORK_LABEL[phoneNetwork]}`
    : phoneNetwork ? 'Not connected' : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.intro}>Choose where your RGB assets live. One is used at a time: a connected RGB node takes over from this phone.</Text>

      {RGB_L1_ENABLED && (
        <View style={[styles.group, !node.connected && phoneConnected && { borderColor: color }]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="RGB on this phone" accessibilityState={{ expanded: open, selected: !node.connected && phoneConnected }}
            onPress={() => setOpen((v) => !v)} activeOpacity={0.7} style={styles.row}>
            <View style={[styles.icon, { backgroundColor: color + '1A' }]}>
              <Ionicons name="phone-portrait-outline" size={18} color={color} />
            </View>
            <View style={styles.text}>
              <Text style={styles.label}>RGB on this phone</Text>
              <Text style={styles.description} numberOfLines={2}>On-chain RGB assets, no node needed · beta</Text>
            </View>
            {phoneStatus && <Badge label={phoneStatus} tone={phoneStatus.startsWith('In use') ? 'success' : 'neutral'} size="sm" />}
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
          {open && (
            <View style={styles.divider}>
              <RgbOnDeviceSettings walletId={walletId} nodeActive={node.connected} onOpenNode={onOpenNode}
                onChanged={() => { void refresh(); onChanged?.(); }} />
            </View>
          )}
        </View>
      )}

      <View style={[styles.group, node.connected && { borderColor: color }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="RGB Lightning Node" accessibilityState={{ selected: node.connected }}
          onPress={onOpenNode} activeOpacity={0.7} style={styles.row}>
          <View style={[styles.icon, { backgroundColor: color + '1A' }]}>
            <Ionicons name="server-outline" size={18} color={color} />
          </View>
          <View style={styles.text}>
            <Text style={styles.label}>RGB Lightning Node</Text>
            <Text style={styles.description} numberOfLines={2}>
              {node.connected
                ? [node.alias || 'Your node', nodeNetwork].filter(Boolean).join(' · ')
                : 'Your own node, remote · Lightning, channels and swaps'}
            </Text>
          </View>
          <Badge label={node.connected ? 'In use' : 'Not connected'} tone={node.connected ? 'success' : 'neutral'} size="sm" />
          <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[3], marginBottom: theme.spacing[4] },
  intro: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  group: {
    backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.xl,
    borderWidth: 1, borderColor: theme.colors.border.light, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 64, paddingVertical: theme.spacing[3] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  description: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
});
