// components/chat/ChatEmptyState.tsx
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/ThemeProvider';
import SuggestionCard from './SuggestionCard';

interface ChatEmptyStateProps {
  /** Prefill + auto-send a suggested query. */
  onSuggestion: (query: string) => void;
  /** Open the Nostr contacts selector. */
  onContacts: () => void;
}

/**
 * First-run hero for the AI assistant: animated avatar, a one-line value prop,
 * a prominent privacy note, then a grid of tappable capability cards that map
 * 1:1 to the on-device wallet tools. Replaces the old wall-of-text welcome
 * bubble.
 */
const ChatEmptyState: React.FC<ChatEmptyStateProps> = ({ onSuggestion, onContacts }) => {
  const theme = useAppTheme();

  const suggestions = [
    {
      icon: 'wallet-outline' as const,
      title: 'Check balance',
      subtitle: "What's my balance?",
      gradient: theme.colors.primary.gradient!,
      onPress: () => onSuggestion("What's my balance?"),
    },
    {
      icon: 'receipt-outline' as const,
      title: 'Create invoice',
      subtitle: 'Invoice for 5,000 sats',
      gradient: theme.colors.success.gradient!,
      onPress: () => onSuggestion('Generate an invoice for 5000 sats'),
    },
    {
      icon: 'download-outline' as const,
      title: 'Receive',
      subtitle: 'Get an address',
      gradient: theme.colors.accent.gradient!,
      onPress: () => onSuggestion('Show my receive address'),
    },
    {
      icon: 'people-outline' as const,
      title: 'Pay a contact',
      subtitle: 'From your Nostr contacts',
      gradient: [theme.colors.brand.violet, theme.colors.protocol.arkade] as [string, string],
      onPress: onContacts,
    },
    {
      icon: 'storefront-outline' as const,
      title: 'Find merchants',
      subtitle: 'Bitcoin shops near you',
      gradient: theme.colors.warning.gradient!,
      onPress: () => onSuggestion('Find Bitcoin-accepting merchants near me'),
    },
    {
      icon: 'time-outline' as const,
      title: 'Recent activity',
      subtitle: 'Your latest transactions',
      gradient: theme.colors.info.gradient!,
      onPress: () => onSuggestion('Show my recent transactions'),
    },
  ];

  // Pair suggestions into rows of two for the grid layout.
  const rows: (typeof suggestions)[] = [];
  for (let i = 0; i < suggestions.length; i += 2) {
    rows.push(suggestions.slice(i, i + 2));
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <LinearGradient
        colors={theme.colors.primary.gradient!}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.avatar, theme.shadows.lg]}
      >
        <Ionicons name="sparkles" size={30} color="#fff" />
      </LinearGradient>

      <Text style={[styles.headline, { color: theme.colors.text.primary }]}>
        Your private AI assistant
      </Text>

      <View style={[styles.privacyPill, { backgroundColor: theme.colors.surface.highlight }]}>
        <Ionicons name="lock-closed" size={13} color={theme.colors.primary[600]} />
        <Text style={[styles.privacyText, { color: theme.colors.primary[700] ?? theme.colors.primary[600] }]}>
          Runs fully on-device · nothing leaves your phone
        </Text>
      </View>

      <Text style={[styles.prompt, { color: theme.colors.text.tertiary }]}>
        Tap a suggestion or type below to get started
      </Text>

      <View style={styles.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.gridRow}>
            {row.map((s) => (
              <SuggestionCard
                key={s.title}
                icon={s.icon}
                title={s.title}
                subtitle={s.subtitle}
                gradient={s.gradient}
                onPress={s.onPress}
              />
            ))}
            {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  privacyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginTop: 12,
  },
  privacyText: { fontSize: 12, fontWeight: '600' },
  prompt: { fontSize: 13, marginTop: 16, marginBottom: 20, textAlign: 'center' },
  grid: { width: '100%', gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
});

export default ChatEmptyState;
