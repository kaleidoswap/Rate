import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';
import { leading } from '../theme';
import { CopyButton } from './CopyButton';
import { AmountText } from './AmountText';
import { NetworkIcon } from './NetworkIcon';
import { middleEllipsis } from './receive/ReceiveRequestDetails';

export interface ReceiptDetails {
  amount: string; recipient?: string; destination?: string; fees?: string; total: string;
  account?: string; reference?: string; createdAt?: number;
  /** How it is paid, e.g. "Lightning", with its icon key (see NetworkIcon). */
  method?: string; methodIcon?: string;
}

type Section = 'all' | 'fees' | 'details';

/**
 * Same reading order before approval and after returning to a saved payment: the amount and
 * fees (amount, fees, total), then who and how (recipient, account, network, date, reference).
 * `sections` shows one group only, e.g. fees always and details on demand.
 */
export function PaymentReceiptDetails({ details: d, quoted = true, sections = 'all' }: { details: ReceiptDetails; quoted?: boolean; sections?: Section }) {
  const t = useAppTheme();
  const s = styles(t);
  const row = (label: string, value: React.ReactNode, first = false) => <View key={label} style={[s.row, !first && s.divider]}>
    <Text style={s.label}>{label}</Text>
    <View style={s.valueWrap}>{typeof value === 'string' ? <Text selectable style={s.value}>{value}</Text> : value}</View>
  </View>;
  const amount = (value: string, strong = false) => <AmountText selectable style={[s.value, strong && s.strong]}>{value}</AmountText>;

  const fees = <View style={s.card}>
    {row('Amount', amount(d.amount), true)}
    {row(quoted ? 'Quoted fees' : 'Fees', d.fees ? amount(d.fees) : 'Not recorded')}
    {row(quoted ? 'Quoted total' : 'Total', amount(d.total, true))}
  </View>;

  const details = <View style={s.card}>
    {row('Recipient', d.recipient || 'Not saved with this payment', true)}
    {!!d.destination && <Text selectable numberOfLines={2} style={s.destination}>{d.destination}</Text>}
    {!!d.account && row('From account', d.account)}
    {!!d.method && row('Network', <View style={s.chip}>
      {!!d.methodIcon && <NetworkIcon network={d.methodIcon} size={14} />}
      <Text style={s.chipText} numberOfLines={1}>{d.method}</Text>
    </View>)}
    {!!d.createdAt && row('Requested', new Date(d.createdAt).toLocaleString())}
    {!!d.reference && row('Reference', <>
      <Text selectable numberOfLines={1} style={s.mono}>{middleEllipsis(d.reference, 8, 8)}</Text>
      <CopyButton value={d.reference} label="Copy reference" size={14} />
    </>)}
  </View>;

  if (sections === 'fees') return fees;
  if (sections === 'details') return details;
  return <View style={{ gap: t.spacing[3] }}>{fees}{details}</View>;
}

const styles = (t: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  card: {
    paddingHorizontal: t.spacing[4], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary,
    borderWidth: 1, borderColor: t.colors.border.light,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing[4], minHeight: 44, paddingVertical: t.spacing[2] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border.light },
  label: { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm, lineHeight: leading(t.typography.fontSize.sm) },
  valueWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: t.spacing[2] },
  value: { flexShrink: 1, textAlign: 'right', color: t.colors.text.primary, fontSize: t.typography.fontSize.sm, lineHeight: leading(t.typography.fontSize.sm), fontWeight: t.typography.fontWeight.medium },
  strong: { fontWeight: t.typography.fontWeight.bold },
  destination: { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, lineHeight: leading(t.typography.fontSize.xs), paddingBottom: t.spacing[2] },
  mono: { flexShrink: 1, color: t.colors.text.primary, fontSize: t.typography.fontSize.xs, lineHeight: leading(t.typography.fontSize.xs), fontFamily: t.typography.fontFamily.mono },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: t.spacing[1], flexShrink: 1, paddingHorizontal: t.spacing[2], paddingVertical: t.spacing[0.5],
    borderRadius: t.borderRadius.sm, backgroundColor: t.colors.surface.tertiary,
  },
  chipText: { color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs, lineHeight: leading(t.typography.fontSize.xs), fontWeight: t.typography.fontWeight.semibold },
});
