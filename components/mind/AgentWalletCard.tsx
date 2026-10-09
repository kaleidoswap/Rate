// Mind tab shortcut to the Agent wallet: its balance and what is left today.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { Card } from '../Card';
import { AmountText } from '../AmountText';
import { useAgentWallet } from '../../hooks/useAgentWallet';
import { formatSats } from '../../services/aiConfirm';

export function AgentWalletCard({ onPress }: { onPress: () => void }) {
  const { state } = useAgentWallet();
  if (state.loading) return null;
  const left = state.policy && state.totals ? Math.max(0, state.policy.dailySats - state.totals.todaySats) : null;
  return (
    <Card onPress={onPress} style={styles.card} testID="agent-wallet-card">
      <View style={styles.row}>
        <View style={styles.icon}><Ionicons name="wallet-outline" size={18} color={theme.colors.accent[500]} /></View>
        <View style={styles.body}>
          <Text style={styles.title}>Agent wallet</Text>
          {state.enabled ? (
            <Text style={styles.desc} numberOfLines={1}>
              {state.policy?.paused ? 'Paused' : left != null ? `${formatSats(left)} left today` : 'On'}
            </Text>
          ) : (
            <Text style={styles.desc} numberOfLines={2}>Give the assistant its own budget to pay for services.</Text>
          )}
        </View>
        {state.enabled && state.balanceSats != null && <AmountText style={styles.amount}>{formatSats(state.balanceSats)}</AmountText>}
        <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: theme.spacing[4], marginTop: theme.spacing[3], padding: theme.spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  icon: { width: 36, height: 36, borderRadius: theme.borderRadius.base, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface.tertiary },
  body: { flex: 1 },
  title: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  desc: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginTop: 2 },
  amount: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
});
