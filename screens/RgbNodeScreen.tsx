// screens/RgbNodeScreen.tsx
//
// Settings › RGB › RGB Lightning Node: what a node adds, how to connect one over
// Nostr Wallet Connect, and its status (shown first). The connection itself (paste or scan,
// saved connections, remove) lives in NWCConnect. NWC has no backup call, so a connected
// node gets a Backup section saying where its RGB and channel state is protected.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppSelector } from '../store/hooks';
import { Badge, Button, Callout, MainHeader } from '../components';
import { RgbNodeIcon } from '../components/RgbNodeIcon';
import { theme, leading } from '../theme';
import { protocolManager, rgbNodeConnected } from '../services/protocols';
import { rgbNetworkLabel } from '../services/protocols/rgbAccount';

interface Props {
  navigation: any;
}

const STEPS = [
  'On your node, create a Nostr Wallet Connect (NWC) connection.',
  'Scan its QR code or paste its nostr+walletconnect:// link.',
  'Review what the node allows and confirm.',
];

export const NODE_BACKUP = {
  title: 'Not restored by your recovery phrase',
  message: 'Your recovery phrase doesn’t bring back anything on this node: not its bitcoin, RGB assets or Lightning channels. The node has its own keys, and only the node’s own backups protect them.',
  action: 'If you run the node, back it up where it runs. If someone else runs it, ask them how it’s backed up.',
  contrast: 'RGB on this phone is different: it tries to back up to the cloud after every change. Check its status under RGB on this phone.',
} as const;

const RgbNodeScreen: React.FC<Props> = ({ navigation }) => {
  const connections = useAppSelector((s: any) => s.nostr?.nwcConnections ?? []);
  const selectedId = useAppSelector((s: any) => s.nostr?.selectedNwcConnectionId ?? null);
  const selected = connections.find((c: any) => c.id === selectedId);
  const [nodeConnected, setNodeConnected] = useState(rgbNodeConnected());
  const [walletConnected, setWalletConnected] = useState(!!protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected());

  const refresh = useCallback(() => {
    setNodeConnected(rgbNodeConnected());
    setWalletConnected(!!protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected());
  }, []);
  useEffect(() => {
    refresh();
    const unsubscribe = navigation.addListener?.('focus', refresh);
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [navigation, refresh, selectedId]);

  const accent = theme.colors.primary[500];
  const network = rgbNetworkLabel(selected?.network);
  const plainWallet = walletConnected && !nodeConnected;

  return (
    <View style={styles.container}>
      <MainHeader title="RGB Lightning Node" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, nodeConnected && { borderColor: theme.colors.success[500] + '66' }]}>
          <View style={styles.statusRow}>
            <View style={styles.icon}><RgbNodeIcon size={30} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{nodeConnected ? selected?.alias || 'Your RGB node' : 'RGB Lightning Node'}</Text>
              <Text style={styles.meta}>{nodeConnected ? ['Connected over NWC', network].filter(Boolean).join(' · ') : 'Lightning, channels and swaps for RGB assets'}</Text>
            </View>
            <Badge label={nodeConnected ? 'Connected' : 'Not connected'} tone={nodeConnected ? 'success' : 'neutral'}
              icon={nodeConnected ? 'checkmark-circle' : undefined} size="sm" />
          </View>
          <Text style={styles.text}>
            {nodeConnected
              ? 'It’s your RGB account now. RGB on this phone is paused while it’s connected.'
              : 'While connected, it’s your RGB account instead of this phone.'}
          </Text>
          {nodeConnected && (
            <Button title="Manage connection" variant="secondary" onPress={() => navigation.navigate('NWCConnect')} fullWidth />
          )}
        </View>

        {nodeConnected && (
          <>
            <Text accessibilityRole="header" style={styles.sectionLabel}>Backup</Text>
            <View style={styles.card}>
              <Callout tone="warning" icon="cloud-offline-outline" title={NODE_BACKUP.title} message={NODE_BACKUP.message} />
              <Text style={styles.text}>{NODE_BACKUP.action}</Text>
              <Text style={styles.meta}>{NODE_BACKUP.contrast}</Text>
            </View>
          </>
        )}

        {plainWallet && (
          <Callout tone="info" message={`${selected?.alias || 'Your Lightning wallet'} is connected over NWC, but it isn’t an RGB node: it’s used for Lightning, and your RGB assets stay on this phone.`} />
        )}

        {!nodeConnected && (
          <>
            <Text accessibilityRole="header" style={styles.sectionLabel}>How to connect</Text>
            <View style={styles.card}>
              {STEPS.map((step, i) => (
                <View key={step} style={styles.step}>
                  <View style={[styles.stepNumber, { backgroundColor: accent + '1A' }]}>
                    <Text style={[styles.stepNumberText, { color: accent }]}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.text, { flex: 1 }]}>{step}</Text>
                </View>
              ))}
              <Text style={styles.meta}>Use the same network as your other accounts.</Text>
            </View>
            <View style={styles.actions}>
              <Button title="Connect node" onPress={() => navigation.navigate('NWCConnect')} fullWidth />
              <Button title="Scan QR code" variant="secondary" onPress={() => navigation.navigate('QRScanner')} fullWidth />
              {connections.length > 0 && (
                <Button title="Saved connections" variant="ghost" onPress={() => navigation.navigate('NWCConnect')} fullWidth />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { padding: theme.spacing[4], gap: theme.spacing[3] },
  card: {
    backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.xl, borderWidth: 1,
    borderColor: theme.colors.border.light, padding: theme.spacing[4], gap: theme.spacing[3],
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background.secondary },
  title: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.text.primary },
  meta: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
  text: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, lineHeight: leading(theme.typography.fontSize.sm, 1.5) },
  sectionLabel: {
    fontSize: theme.typography.fontSize.xs, fontWeight: '700', color: theme.colors.text.tertiary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: theme.spacing[2], marginLeft: theme.spacing[1],
  },
  step: { flexDirection: 'row', gap: theme.spacing[3], alignItems: 'center' },
  stepNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: theme.typography.fontSize.xs, fontWeight: '700' },
  actions: { gap: theme.spacing[2], marginTop: theme.spacing[1] },
});

export default RgbNodeScreen;
