// components/SectionHeader.tsx
//
// "Title  ······  Action →" row above a list/section. Standardises the pattern
// that AssetList, Settings and others each re-implement, so spacing and the
// action-link styling stay identical everywhere.
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { typeRoles } from '../theme/partner';
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
}) => {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  return (
    <View style={[styles.header, style]}>
      <Text style={[styles.title, eyebrow && styles.eyebrow]}>{title}</Text>
      {actionLabel && onAction && (
        <PressableScale
          onPress={onAction}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          // The link is small; the touch target still reaches 44pt.
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
          {actionChevron && (
            <Ionicons
              name="chevron-forward"
              size={12}
              color={theme.colors.primary[500]}
            />
          )}
        </PressableScale>
      )}
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
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
      ...typeRoles.mini,
      letterSpacing: typeRoles.mini.fontSize * 0.18,
      textTransform: 'uppercase',
      color: theme.colors.text.secondary,
    },
    // A quiet text link: the section's title leads, the action follows.
    action: {
      paddingVertical: theme.spacing[1],
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing[0.5],
    },
    actionText: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.primary[500],
      fontWeight: theme.typography.fontWeight.semibold,
    },
  });

export default SectionHeader;
