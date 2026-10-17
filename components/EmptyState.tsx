// components/EmptyState.tsx
//
// Thin adapter over the shared kaleido-ui/native EmptyState: keeps Rate's
// props (Ionicons glyph name, `message`, `actionLabel`/`onAction`) so callers
// don't change, while the layout, type scale and icon disc come from the
// design system. The CTA is the kaleido KButton.
import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState as KEmptyState, KButton } from '@kaleidorg/kaleido-ui/native';
import { theme as staticTheme } from '../theme';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'folder-open-outline', title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <KEmptyState
      style={styles.container}
      title={title}
      description={message}
      icon={(color, size) => <Ionicons name={icon} size={size} color={color} />}
      action={
        actionLabel && onAction ? (
          <KButton
            label={actionLabel}
            size="sm"
            onPress={onAction}
            accessibilityLabel={actionLabel}
            style={styles.action}
          />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  // Rate screens drop EmptyState into flex containers / list empty slots and
  // rely on it filling and centering in the remaining space.
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: staticTheme.spacing[10],
    paddingVertical: 60,
  },
  // KButton defaults to alignSelf: flex-start; keep the CTA centered.
  action: {
    alignSelf: 'center',
    marginTop: staticTheme.spacing[3],
  },
});
