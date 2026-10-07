/**
 * Small overlapping network icons: where an asset lives (on-chain, Lightning,
 * Spark, Arkade, Bark, RGB…). Optionally followed by the first network's name.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { NetworkIcon } from './NetworkIcon';

interface NetworkStackProps {
  networks: string[];
  size?: number;
  /** Text after the icons, e.g. "Spark" or "3 networks". */
  label?: string;
  /** Ring colour around each icon; match the surface behind it. */
  ringColor?: string;
}

export const NetworkStack: React.FC<NetworkStackProps> = ({ networks, size = 14, label, ringColor = theme.colors.surface.primary }) => {
  if (!networks.length && !label) return null;
  const ring = Math.max(1, Math.round(size / 10));
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.icons}>
        {networks.map((n, i) => (
          <View
            key={n}
            style={{
              marginLeft: i === 0 ? 0 : -size * 0.3,
              borderRadius: (size + ring * 2) / 2,
              borderWidth: ring,
              borderColor: ringColor,
              backgroundColor: ringColor,
              zIndex: networks.length - i,
            }}
          >
            <NetworkIcon network={n} size={size} />
          </View>
        ))}
      </View>
      {!!label && <Text style={styles.label} numberOfLines={1}>{label}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1], flexShrink: 1 },
  icons: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, flexShrink: 1 },
});

export default NetworkStack;
