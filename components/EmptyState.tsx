// components/EmptyState.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme as staticTheme } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'folder-open-outline', title, message, actionLabel, onAction }: EmptyStateProps) {
  const theme = useAppTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: theme.colors.surface.tertiary }]}>
        <Ionicons name={icon} size={40} color={theme.colors.text.tertiary} />
      </View>
      <Text style={[styles.title, { color: theme.colors.text.primary }]}>{title}</Text>
      {message && (
        <Text style={[styles.message, { color: theme.colors.text.secondary }]}>{message}</Text>
      )}
      {actionLabel && onAction && (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.colors.primary[600] }]}
          onPress={onAction}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing[10],
    paddingVertical: 60,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: staticTheme.spacing[5],
  },
  title: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    textAlign: 'center',
    marginBottom: staticTheme.spacing[2],
  },
  message: {
    fontSize: staticTheme.typography.fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButton: {
    marginTop: staticTheme.spacing[6],
    paddingHorizontal: staticTheme.spacing[6],
    paddingVertical: staticTheme.spacing[3],
    borderRadius: staticTheme.borderRadius.md,
  },
  actionLabel: {
    color: staticTheme.colors.text.inverse,
    fontSize: 15,
    fontWeight: staticTheme.typography.fontWeight.semibold,
  },
});
