// components/Badge.tsx
//
// A small pill label — status, protocol tag, public/private, "BEST", etc.
// Replaces the dozens of hand-rolled `<View><Text>` pills scattered across
// screens, each with slightly different padding/alpha. Background is a
// translucent tint of the accent; text/icon use the solid accent.
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /** Explicit accent (e.g. a protocol color). Overrides `tone`. */
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: BadgeSize;
  /** Solid fill (white-ish text) instead of the default translucent tint. */
  solid?: boolean;
  style?: ViewStyle;
}

const TONE_COLOR: Record<BadgeTone, string> = {
  neutral: theme.colors.text.tertiary,
  primary: theme.colors.primary[500],
  success: theme.colors.success[500],
  warning: theme.colors.warning[500],
  error: theme.colors.error[500],
  info: theme.colors.info[500],
};

export const Badge: React.FC<BadgeProps> = ({
  label,
  tone = 'neutral',
  color,
  icon,
  size = 'sm',
  solid = false,
  style,
}) => {
  const accent = color ?? TONE_COLOR[tone];
  const isSm = size === 'sm';
  const fg = solid ? '#FFFFFF' : accent;

  return (
    <View
      style={[
        styles.base,
        isSm ? styles.sm : styles.md,
        { backgroundColor: solid ? accent : accent + '22' },
        style,
      ]}
      accessible
      accessibilityLabel={label}
    >
      {icon && (
        <Ionicons name={icon} size={isSm ? 10 : 12} color={fg} style={styles.icon} />
      )}
      <Text style={[isSm ? styles.textSm : styles.textMd, { color: fg }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: theme.borderRadius.full,
  },
  sm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  md: {
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  icon: {
    marginRight: 3,
  },
  textSm: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  textMd: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default Badge;
