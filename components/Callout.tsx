// components/Callout.tsx
//
// A tinted inline message block — info hints, soft errors, warnings. Replaces
// the bespoke `error[50]` / `primary[50]` cards inlined in Swap, Send, etc.,
// each of which re-derived its own background/border/icon. Tone drives the
// accent; pass a title and/or message, or arbitrary children.
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

export type CalloutTone = 'info' | 'success' | 'warning' | 'error';

interface CalloutProps {
  tone?: CalloutTone;
  title?: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children?: React.ReactNode;
  style?: ViewStyle;
}

const TONE: Record<CalloutTone, { accent: string; icon: keyof typeof Ionicons.glyphMap }> = {
  info: { accent: theme.colors.info[500], icon: 'information-circle-outline' },
  success: { accent: theme.colors.success[500], icon: 'checkmark-circle-outline' },
  warning: { accent: theme.colors.warning[500], icon: 'warning-outline' },
  error: { accent: theme.colors.error[500], icon: 'alert-circle-outline' },
};

export const Callout: React.FC<CalloutProps> = ({
  tone = 'info',
  title,
  message,
  icon,
  children,
  style,
}) => {
  const t = TONE[tone];
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: t.accent + '14', borderColor: t.accent + '33' },
        style,
      ]}
      accessibilityRole="alert"
    >
      <Ionicons name={icon ?? t.icon} size={18} color={t.accent} style={styles.icon} />
      <View style={styles.body}>
        {!!title && <Text style={[styles.title, { color: t.accent }]}>{title}</Text>}
        {!!message && <Text style={styles.message}>{message}</Text>}
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    gap: theme.spacing[2],
  },
  icon: {
    marginTop: 1,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '700',
  },
  message: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    lineHeight: 19,
  },
});

export default Callout;
