// Dismissible insight cards for the Dashboard, each with Prismo and one action.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { Card } from '../Card';
import { Button } from '../Button';
import { MindCharacter } from './MindCharacter';
import { useInsights } from '../../hooks/useInsights';
import type { Insight, InsightAction } from '../../services/insights';

interface Props {
  channels?: any[];
  onAction: (action: Exclude<InsightAction, { kind: 'backup-rgb' }>) => void;
}

const TONE: Record<Insight['tone'], string> = {
  info: theme.colors.info[500],
  warning: theme.colors.warning[500],
  success: theme.colors.success[500],
};

export function InsightCard({ insight, onAction, onDismiss }: {
  insight: Insight; onAction: () => Promise<void> | void; onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Card variant="outlined" style={[styles.card, { borderColor: TONE[insight.tone] + '55' }]} testID={`insight-${insight.rule}`}>
      <View style={styles.row}>
        <MindCharacter mood={insight.mood} size={36} animated={false} />
        <View style={styles.body}>
          <Text style={styles.title}>{insight.title}</Text>
          <Text style={styles.message}>{insight.message}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Dismiss: ${insight.title}`} onPress={onDismiss}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color={theme.colors.text.tertiary} />
        </TouchableOpacity>
      </View>
      <Button
        title={insight.action.label}
        size="sm"
        variant="secondary"
        loading={busy}
        style={styles.action}
        onPress={async () => { setBusy(true); try { await onAction(); } finally { setBusy(false); } }}
      />
    </Card>
  );
}

export function InsightCards({ channels, onAction }: Props) {
  const { insights, dismiss, backupNow } = useInsights(channels);
  if (!insights.length) return null;
  return (
    <View style={styles.list}>
      {insights.map((i) => (
        <InsightCard key={i.key} insight={i} onAction={() => (i.action.do.kind === 'backup-rgb' ? backupNow() : onAction(i.action.do))} onDismiss={() => void dismiss(i.key)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: theme.spacing[4], marginBottom: theme.spacing[4], gap: theme.spacing[3] },
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[3] },
  body: { flex: 1, gap: theme.spacing[1] },
  title: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  message: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, lineHeight: 19 },
  action: { alignSelf: 'flex-start' },
});
