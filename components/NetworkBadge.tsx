// components/NetworkBadge.tsx
//
// Small tone-coloured pill showing which network a protocol is on. Tone follows
// the safety convention (mirrors the rate-extension): mainnet = green (safe),
// testnet/signet = amber (caution), regtest = red (local/dev). Makes it obvious
// at a glance when the wallet is NOT on mainnet.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';

export type NetworkTone = 'mainnet' | 'caution' | 'regtest';

const LABELS: Record<string, string> = {
  mainnet: 'Mainnet',
  testnet: 'Testnet',
  regtest: 'Regtest',
  signet: 'Mutinynet',
};

export function networkTone(network: string): NetworkTone {
  const n = network.toLowerCase();
  if (n === 'mainnet') return 'mainnet';
  if (n === 'regtest') return 'regtest';
  return 'caution'; // testnet, signet, mutinynet…
}

interface NetworkBadgeProps {
  network: string;
  /** Show a chevron (when the badge is tappable to change network). */
  interactive?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const NetworkBadge: React.FC<NetworkBadgeProps> = ({
  network,
  interactive,
  onPress,
  style,
  accessibilityLabel,
}) => {
  const theme = useAppTheme();
  const tone = networkTone(network);
  const palette =
    tone === 'mainnet' ? theme.colors.success : tone === 'regtest' ? theme.colors.error : theme.colors.warning;

  const body = (
    <View
      style={[
        styles.badge,
        { backgroundColor: palette[50], borderColor: palette[500] },
        style,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: palette[500] }]} />
      <Text style={[styles.label, { color: palette[600] ?? palette[500] }]}>
        {LABELS[network.toLowerCase()] ?? network}
      </Text>
      {interactive && <Ionicons name="chevron-down" size={11} color={palette[500]} />}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} accessibilityLabel={accessibilityLabel} activeOpacity={0.7}>
        {body}
      </TouchableOpacity>
    );
  }
  return body;
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.2 },
});

export default NetworkBadge;
