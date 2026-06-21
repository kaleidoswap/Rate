// components/SectionHeader.tsx
//
// "Title  ······  Action →" row above a list/section. Standardises the pattern
// that AssetList, Settings and others each re-implement, so spacing and the
// action-link styling stay identical everywhere.
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { PressableScale } from './PressableScale';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Show a chevron after the action label (default true when an action exists). */
  actionChevron?: boolean;
  /** Render the title as an uppercase, wide-tracked, dimmed eyebrow (extension parity). */
  eyebrow?: boolean;
  style?: ViewStyle;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  actionLabel,
  onAction,
  actionChevron = true,
  eyebrow = false,
  style,
}) => (
  <View style={[styles.header, style]}>
    <Text style={[styles.title, eyebrow && styles.eyebrow]}>{title}</Text>
    {actionLabel && onAction && (
      <PressableScale
        onPress={onAction}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.actionText}>{actionLabel}</Text>
        {actionChevron && (
          <Ionicons name="chevron-forward" size={14} color={theme.colors.primary[600]} />
        )}
      </PressableScale>
    )}
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  title: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
  },
  eyebrow: {
    fontSize: theme.typography.fontSize.xs,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: theme.colors.text.secondary,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[0.5],
  },
  actionText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    fontWeight: theme.typography.fontWeight.semibold,
  },
});

export default SectionHeader;
