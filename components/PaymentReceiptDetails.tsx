import React from 'react';
import { View, Text } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';
import { CopyButton } from './CopyButton';

export interface ReceiptDetails {
  amount: string; recipient?: string; destination?: string; fees?: string; total: string;
  account?: string; reference?: string; createdAt?: number;
}
/** Same reading order before approval and after returning to a saved payment. */
export function PaymentReceiptDetails({ details: d, quoted = true }: { details: ReceiptDetails; quoted?: boolean }) {
  const t = useAppTheme();
  const row = (label: string, value: string, strong = false) => <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[4] }}>
    <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{label}</Text>
    <Text selectable style={{ flex: 1, textAlign: 'right', color: t.colors.text.primary, fontSize: t.typography.fontSize.sm, fontWeight: strong ? '700' : '500' }}>{value}</Text>
  </View>;
  return <View style={{ padding: t.spacing[4], gap: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light }}>
    {row('Amount', d.amount)}
    {row('Recipient', d.recipient || 'Not saved with this payment')}
    {!!d.destination && <Text selectable numberOfLines={2} style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>{d.destination}</Text>}
    {row(quoted ? 'Quoted fees' : 'Fees', d.fees ?? 'Not recorded')}
    <View style={{ height: 1, backgroundColor: t.colors.border.light }} />
    {row(quoted ? 'Quoted total' : 'Total', d.total, true)}
    {!!d.account && row('From account', d.account)}
    {!!d.createdAt && row('Requested', new Date(d.createdAt).toLocaleString())}
    {!!d.reference && <View style={{ gap: t.spacing[1] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>Reference</Text>
        <CopyButton value={d.reference} label="Copy reference" size={14} />
      </View>
      <Text selectable style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>{d.reference}</Text>
    </View>}
  </View>;
}
