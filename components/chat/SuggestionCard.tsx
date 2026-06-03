// components/chat/SuggestionCard.tsx
import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { ColorGradient } from '../../theme';

export interface SuggestionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  gradient: ColorGradient;
  onPress: () => void;
}

/**
 * A tappable capability card shown in the chat empty state. Icon sits in a
 * gradient chip; title + example query sit beside it. Used in a 2-column grid.
 */
const SuggestionCard: React.FC<SuggestionCardProps> = ({ icon, title, subtitle, gradient, onPress }) => {
  const theme = useAppTheme();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface.primary,
          borderColor: theme.colors.border.light,
          ...theme.shadows.sm,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    >
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconChip}>
        <Ionicons name={icon} size={18} color="#fff" />
      </LinearGradient>
      <View style={styles.textArea}>
        <Text style={[styles.title, { color: theme.colors.text.primary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.text.tertiary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textArea: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
  subtitle: { fontSize: 11, marginTop: 2, lineHeight: 15 },
});

export default SuggestionCard;
