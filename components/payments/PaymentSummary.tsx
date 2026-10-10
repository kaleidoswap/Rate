import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { ConfirmReadback, ReadbackRow } from '../../services/aiConfirm';

export const isPaymentCostRow = (row: ReadbackRow) => /^(fee|fees|total)$/i.test(row.label.trim());

/** Display the confirmation's authoritative values; never invent a fee or total. */
export function PaymentSummary({ readback, fiat }: { readback: ConfirmReadback; fiat?: string }) {
  const t = useAppTheme();
  const costs = readback.rows.filter(isPaymentCostRow);
  const recipient = readback.recipientName || readback.rows.find(r => /^(contact|recipient|destination|lightning address|nostr contact|bitcoin address)$/i.test(r.label))?.value;
  const hasFee = costs.some(r => /^fees?$/i.test(r.label.trim()));
  return <View style={[styles.card, { backgroundColor: t.colors.surface.secondary, borderColor: t.colors.border.light }]}>
    <Text style={[styles.caption, { color: t.colors.text.secondary }]}>Amount</Text>
    <Text testID="confirm-amount" style={[styles.amount, { color: t.colors.text.primary }]}>{readback.amount || 'See payment details'}</Text>
    {!!fiat && <Text style={[styles.caption, { color: t.colors.text.secondary }]}>{fiat}</Text>}
    <View style={styles.row}>
      <Text style={[styles.label, { color: t.colors.text.secondary }]}>To</Text>
      <Text selectable style={[styles.value, { color: t.colors.text.primary }]}>{recipient || 'See destination below'}</Text>
    </View>
    <View style={[styles.costs, { borderTopColor: t.colors.border.light }]}>
      {!hasFee && <View style={styles.row}><Text style={[styles.label, { color: t.colors.text.secondary }]}>Fee</Text><Text style={[styles.value, { color: t.colors.text.primary }]}>Not available yet</Text></View>}
      {costs.map(row => <View key={row.label} style={styles.row}>
        <Text style={[styles.label, { color: t.colors.text.secondary }]}>{row.label}</Text>
        <Text style={[styles.value, { color: t.colors.text.primary }]}>{row.value}</Text>
      </View>)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, marginBottom: 12 },
  caption: { fontSize: 12, lineHeight: 18 },
  amount: { fontSize: 28, lineHeight: 36, fontWeight: '700', fontVariant: ['tabular-nums'], marginBottom: 6 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 3 },
  label: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  value: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'right' },
  costs: { marginTop: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
});
