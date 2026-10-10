import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { theme as tokens } from '../../theme';

interface ChatEmptyStateProps {
  onSuggestion: (query: string) => void;
  onContacts: () => void;
  hero?: React.ReactNode;
  needsSetup?: boolean;
  onSetup?: () => void;
}

/** One next step before setup; a few relevant suggestions once Agent is enabled. */
export default function ChatEmptyState({ onSuggestion, onContacts, hero, needsSetup = false, onSetup }: ChatEmptyStateProps) {
  const theme = useAppTheme();
  const suggestions = [
    { icon: 'wallet-outline' as const, label: 'Check my balance', action: () => onSuggestion("What's my balance?") },
    { icon: 'people-outline' as const, label: 'Pay a contact', action: onContacts },
    { icon: 'download-outline' as const, label: 'Receive bitcoin', action: () => onSuggestion('Show my receive address') },
  ];
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>{hero}</View>
      <Text style={[styles.title, { color: theme.colors.text.primary }]}>{needsSetup ? 'Meet Prismo' : 'How can I help?'}</Text>
      <Text style={[styles.subtitle, { color: theme.colors.text.secondary }]}>
        {needsSetup ? 'Your wallet, one conversation away.\nCheck balances, receive bitcoin and prepare payments.' : 'Ask about your wallet, or start with a suggestion.'}
      </Text>
      {needsSetup ? (
        <View style={styles.actions}>
          <TouchableOpacity onPress={onSetup} accessibilityRole="button" accessibilityLabel="Set up Prismo"
            style={[styles.primary, { backgroundColor: theme.colors.primary[500] }]}>
            <Text style={[styles.primaryLabel, { color: theme.colors.text.inverse }]}>Set up Prismo</Text>
            <Ionicons name="arrow-forward" size={18} color={theme.colors.text.inverse} />
          </TouchableOpacity>
          <Text style={[styles.note, { color: theme.colors.text.secondary }]}>We’ll check your device and help you get started.</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          {suggestions.map(item => <TouchableOpacity key={item.label} onPress={item.action} accessibilityRole="button"
            style={[styles.suggestion, { backgroundColor: theme.colors.surface.primary, borderColor: theme.colors.border.light }]}>
            <Ionicons name={item.icon} size={20} color={theme.colors.text.secondary} />
            <Text style={[styles.suggestionLabel, { color: theme.colors.text.primary }]}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.text.secondary} />
          </TouchableOpacity>)}
        </View>
      )}
      <View style={styles.reassurance}>
        <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.text.secondary} />
        <Text style={[styles.note, { color: theme.colors.text.secondary }]}>You review payments before they’re sent.</Text>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  hero: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '600', textAlign: 'center' },
  subtitle: { fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 12, maxWidth: 340 },
  actions: { width: '100%', maxWidth: 360, marginTop: 28, gap: 10 },
  primary: { minHeight: 52, paddingHorizontal: 20, paddingVertical: 14, borderRadius: tokens.borderRadius.full, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  primaryLabel: { fontSize: 16, fontWeight: '600' },
  note: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  suggestion: { minHeight: 52, padding: 14, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestionLabel: { flex: 1, fontSize: 15 },
  reassurance: { marginTop: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
});
