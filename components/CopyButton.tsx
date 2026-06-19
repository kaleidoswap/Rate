// components/CopyButton.tsx
//
// One canonical "copy to clipboard" affordance. The hand-rolled versions across
// screens signalled success with a colour change alone (invisible to colour-blind
// users and screen readers); this swaps the icon to a checkmark AND flips the
// label to "Copied", fires a success haptic, and announces via accessibilityLabel.
import React, { useRef, useState, useCallback } from 'react';
// eslint-disable-next-line react-native/no-deprecated -- matches existing app-wide Clipboard usage
import { Clipboard, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';
import { PressableScale } from './PressableScale';

interface CopyButtonProps {
  value: string;
  /** Optional text shown next to the icon (icon-only when omitted). */
  label?: string;
  /** Text shown briefly after copying (default "Copied"). */
  copiedLabel?: string;
  size?: number;
  color?: string;
  onCopied?: () => void;
  style?: ViewStyle;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  label,
  copiedLabel = 'Copied',
  size = 18,
  color = theme.colors.text.secondary,
  onCopied,
  style,
}) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePress = useCallback(() => {
    Clipboard.setString(value);
    feedback.success();
    setCopied(true);
    onCopied?.();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [value, onCopied]);

  const tint = copied ? theme.colors.success[500] : color;
  const text = copied ? copiedLabel : label;

  return (
    <PressableScale
      onPress={handlePress}
      style={[styles.button, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={copied ? `${copiedLabel}` : `Copy ${label ?? 'to clipboard'}`}
    >
      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={size} color={tint} />
      {!!text && <Text style={[styles.label, { color: tint }]}>{text}</Text>}
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
  },
  label: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
  },
});

export default CopyButton;
