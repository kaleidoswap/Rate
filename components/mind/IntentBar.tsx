// A compact "tell me what to do" bar. Tap to type, long-press (or the mic) to
// dictate; the sheet returns an action card or an answer.
import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { MindCharacterBadge } from './MindCharacter';
import { IntentSheet } from './IntentSheet';
import { useAppSelector } from '../../store/hooks';
import { selectAiEnabled } from '../../store/slices/settingsSlice';
import type { ReviewTarget } from '../../services/mindIntents/card';

interface Props {
  onReview: (target: ReviewTarget) => void;
  style?: StyleProp<ViewStyle>;
}

export function IntentBar({ onReview, style }: Props) {
  const [open, setOpen] = useState<null | 'type' | 'listen'>(null);
  const voice = useAppSelector(selectAiEnabled);
  return (
    <>
      <Pressable
        testID="intent-bar"
        accessibilityRole="button"
        accessibilityLabel="Tell KaleidoMind what to do"
        accessibilityHint={voice ? 'Long-press to dictate' : undefined}
        onPress={() => setOpen('type')}
        onLongPress={voice ? () => setOpen('listen') : undefined}
        style={({ pressed }) => [styles.bar, pressed && styles.pressed, style]}
      >
        <MindCharacterBadge mood="idle" />
        <Text style={styles.placeholder} numberOfLines={1}>Send, receive, swap or ask…</Text>
        {voice && (
          <View style={styles.mic}>
            <Ionicons name="mic-outline" size={16} color={theme.colors.text.secondary} />
          </View>
        )}
      </Pressable>
      <IntentSheet visible={open !== null} listen={open === 'listen'} onClose={() => setOpen(null)} onReview={onReview} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  pressed: { opacity: 0.8 },
  placeholder: { flex: 1, fontSize: theme.typography.fontSize.base, color: theme.colors.text.tertiary },
  mic: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background.secondary },
});
