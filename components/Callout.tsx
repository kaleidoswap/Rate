// components/Callout.tsx
//
// A tinted inline message block — info hints, soft errors, warnings. Replaces
// the bespoke `error[50]` / `primary[50]` cards inlined in Swap, Send, etc.,
// each of which re-derived its own background/border/icon. Tone drives the
// accent; pass a title and/or message, or arbitrary children.
//
// The container (tinted wash, border, radius, padding) is the shared
// kaleido-ui/native AlertBanner; Rate keeps its tone names, icon and
// title/message layout on top. `tone="error"` maps 1:1 to the banner's
// `error` variant (all four tones share names).
import React from 'react';
import { AlertBanner } from '@kaleidorg/kaleido-ui/native';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';

export type CalloutTone = 'info' | 'success' | 'warning' | 'error';

interface CalloutProps {
  tone?: CalloutTone;
  title?: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children?: React.ReactNode;
  style?: ViewStyle;
}

export const Callout: React.FC<CalloutProps> = ({
  tone = 'info',
  title,
  message,
  icon,
  children,
  style,
}) => {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const TONE: Record<
    CalloutTone,
    { accent: string; icon: keyof typeof Ionicons.glyphMap }
  > = {
    info: {
      accent: theme.colors.info[500],
      icon: 'information-circle-outline',
    },
    success: {
      accent: theme.colors.success[500],
      icon: 'checkmark-circle-outline',
    },
    warning: { accent: theme.colors.warning[500], icon: 'warning-outline' },
    error: { accent: theme.colors.error[500], icon: 'alert-circle-outline' },
  };
  const t = TONE[tone];
  return (
    <AlertBanner variant={tone} style={style}>
      {/* AlertBanner doesn't forward a11y props; the role sits on the content. */}
      <View style={styles.content} accessibilityRole="alert">
        <Ionicons
          name={icon ?? t.icon}
          size={18}
          color={t.accent}
          style={styles.icon}
        />
        <View style={styles.body}>
          {!!title && (
            <Text style={[styles.title, { color: t.accent }]}>{title}</Text>
          )}
          {!!message && <Text style={styles.message}>{message}</Text>}
          {children}
        </View>
      </View>
    </AlertBanner>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
    content: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing[2],
    },
    icon: {
      marginTop: 1,
    },
    body: {
      flex: 1,
      gap: theme.spacing[0.5],
    },
    title: {
      fontSize: theme.typography.fontSize.sm,
      fontWeight: theme.typography.fontWeight.bold,
    },
    message: {
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.text.secondary,
      lineHeight: 19,
    },
  });

export default Callout;
