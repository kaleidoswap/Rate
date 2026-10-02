import React from 'react';
import { Text, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { feedback } from '../utils/feedback';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { PressableScale } from './PressableScale';

interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  size?: number;
  color?: string;
  onCopied?: () => void;
  style?: ViewStyle;
}
export function CopyButton({
  value,
  label,
  copiedLabel = 'Copied',
  size = 18,
  color,
  onCopied,
  style,
}: CopyButtonProps) {
  const t = useAppTheme();
  const { state, copy } = useCopyToClipboard(value);
  const copied = state === 'copied',
    failed = state === 'error';
  const text = copied
    ? copiedLabel
    : failed
      ? 'Could not copy. Try again'
      : label;
  const tint = copied
    ? t.colors.success[500]
    : failed
      ? t.colors.error[500]
      : (color ?? t.colors.text.secondary);
  return (
    <PressableScale
      onPress={async () => {
        if (await copy()) {
          feedback.success();
          onCopied?.();
        }
      }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing[1.5],
          minHeight: 44,
          minWidth: 44,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={text ?? 'Copy to clipboard'}
      accessibilityLiveRegion="polite"
    >
      <Ionicons
        name={
          copied
            ? 'checkmark'
            : failed
              ? 'alert-circle-outline'
              : 'copy-outline'
        }
        size={size}
        color={tint}
      />
      {!!text && (
        <Text
          style={{
            fontSize: t.typography.fontSize.sm,
            color: tint,
            flexShrink: 1,
          }}
        >
          {text}
        </Text>
      )}
    </PressableScale>
  );
}
export default CopyButton;
