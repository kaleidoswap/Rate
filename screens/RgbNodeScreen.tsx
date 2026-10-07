// screens/RgbNodeScreen.tsx
//
// Settings › RGB › RGB Lightning Node: what a node adds, how to connect one over
// Nostr Wallet Connect, and its status. The connection itself (paste or scan,
// saved connections, remove) lives in NWCConnect.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppSelector } from '../store/hooks';
import { Badge, Button, Callout, MainHeader } from '../components';
import { theme, protocolColor, leading } from '../theme';
import { protocolManager, rgbNodeConnected } from '../services/protocols';
import { rgbNetworkLabel } from '../services/protocols/rgbAccount';

interface Props {
  navigation: any;
}

const STEPS = [
  'On your node, create a Nostr Wallet Connect (NWC) connection and show its QR code or copy its link.',
  'Tap Connect node, then scan the QR code or paste the nostr+walletconnect:// link.',
  'Review what the node allows and confirm.',
];

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

  const color = protocolColor('RGB');
  const network = rgbNetworkLabel(selected?.network);
  const plainWallet = walletConnected && !nodeConnected;

  return (
    <View style={styles.container}>
      <MainHeader title="RGB Lightning Node" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, nodeConnected && { borderColor: color }]}>
          <View style={styles.statusRow}>
            <View style={[styles.icon, { backgroundColor: color + '1A' }]}>
              <Ionicons name="server-outline" size={20} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{nodeConnected ? selected?.alias || 'Your RGB node' : 'RGB Lightning Node'}</Text>
              <Text style={styles.meta}>{nodeConnected ? ['Connected over NWC', network].filter(Boolean).join(' · ') : 'Not connected'}</Text>
            </View>
            <Badge label={nodeConnected ? 'In use' : 'Off'} tone={nodeConnected ? 'success' : 'neutral'} size="sm" />
          </View>
          <Text style={styles.text}>
            {nodeConnected
              ? 'It’s your RGB account now: RGB assets, Lightning payments, channels and KaleidoSwap swaps go through it. RGB on this phone is paused while it’s connected.'
              : 'Your own RGB Lightning Node (RLN) adds Lightning payments, channels and KaleidoSwap swaps for RGB assets. While it’s connected it is your RGB account; otherwise RGB on this phone is used.'}
          </Text>
          {nodeConnected && (
            <Button title="Manage connection" variant="secondary" onPress={() => navigation.navigate('NWCConnect')} fullWidth />
          )}
        </View>

        {plainWallet && (
          <Callout tone="info" message={`${selected?.alias || 'Your Lightning wallet'} is connected over NWC, but it isn’t an RGB node: it’s used for Lightning, and your RGB assets stay on this phone.`} />
        )}

        {!nodeConnected && (
          <View style={styles.card}>
            <Text style={styles.title}>How to connect</Text>
            {STEPS.map((step, i) => (
              <View key={step} style={styles.step}>
                <View style={[styles.stepNumber, { backgroundColor: color + '1A' }]}>
                  <Text style={[styles.stepNumberText, { color }]}>{i + 1}</Text>
                </View>
                <Text style={[styles.text, { flex: 1 }]}>{step}</Text>
              </View>
            ))}
            <Text style={styles.meta}>Use a node on the same network as your other accounts: mainnet for real funds, a test network for testing.</Text>
            <Button title="Connect node" onPress={() => navigation.navigate('NWCConnect')} fullWidth />
            <Button title="Scan QR code" variant="secondary" onPress={() => navigation.navigate('QRScanner')} fullWidth />
            {connections.length > 0 && (
              <Button title="Saved connections" variant="ghost" onPress={() => navigation.navigate('NWCConnect')} fullWidth />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { padding: theme.spacing[4], gap: theme.spacing[4] },
  card: {
    backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.xl, borderWidth: 1,
    borderColor: theme.colors.border.light, padding: theme.spacing[4], gap: theme.spacing[3],
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  meta: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
  text: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, lineHeight: leading(theme.typography.fontSize.sm, 1.5) },
  step: { flexDirection: 'row', gap: theme.spacing[3], alignItems: 'flex-start' },
  stepNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: theme.typography.fontSize.xs, fontWeight: '700' },
});

export default RgbNodeScreen;
