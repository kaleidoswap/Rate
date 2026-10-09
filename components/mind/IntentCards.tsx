// The structured results of the intent bar: an action card (send / receive /
// swap) and a small answer card (balance / spending). Everything they show was
// computed by the wallet; Review hands off to the existing screens.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { Card } from '../Card';
import { Button } from '../Button';
import { Callout } from '../Callout';
import { AmountText } from '../AmountText';
import { MindCharacterBadge } from './MindCharacter';
import { FIAT_SYMBOLS } from '../../hooks/useFiatRates';
import { formatBitcoinAmount } from '../../utils/bitcoinUnits';
import type { ActionCard } from '../../services/mindIntents/card';
import type { AnswerCard, AnswerRow } from '../../services/mindIntents/questions';

type Unit = 'BTC' | 'sats';

export const formatSats = (sats: number, unit: Unit) => `${formatBitcoinAmount(sats, unit)} ${unit}`;

export function formatFiat(value: number, currency: string): string {
  const symbol = FIAT_SYMBOLS[currency] ?? `${currency} `;
  const digits = currency === 'JPY' ? 0 : value < 1 ? 4 : 2;
  return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits })}`;
}

const formatUnits = (n: number, unit: string) => `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${unit}`;

const KIND_ICON: Record<ActionCard['kind'], keyof typeof Ionicons.glyphMap> = {
  send: 'arrow-up', receive: 'arrow-down', swap: 'swap-horizontal',
};

function Row({ label, children, testID }: { label: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

export function feeText(card: ActionCard, unit: Unit): string {
  const f = card.fee;
  if (!f) return card.amountSat || card.amountUnits ? 'Shown on review' : 'Add an amount to see it';
  if (f.status === 'none') return f.note ?? 'None';
  if (f.status === 'unavailable') return f.note ? `Not available: ${f.note}` : 'Not available';
  if (f.sat != null) return `≈ ${formatSats(f.sat, unit)}`;
  if (f.units != null && f.unit) return `≈ ${formatUnits(f.units, f.unit)}`;
  return 'Shown on review';
}

interface ActionCardViewProps {
  card: ActionCard;
  unit: Unit;
  advanced: boolean;
  onReview: () => void;
  onEdit: () => void;
  onCancel: () => void;
}

export function ActionCardView({ card, unit, advanced, onReview, onEdit, onCancel }: ActionCardViewProps) {
  const amount = card.amountSat != null
    ? formatSats(card.amountSat, unit)
    : card.amountUnits != null ? formatUnits(card.amountUnits, card.asset) : 'You choose on review';
  const accent = card.kind === 'receive' ? theme.colors.tx.receive : card.kind === 'swap' ? theme.colors.tx.swap : theme.colors.tx.sent;
  return (
    <Card variant="outlined" style={styles.card} testID="intent-action-card">
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: accent + '1A' }]}>
          <Ionicons name={KIND_ICON[card.kind]} size={18} color={accent} />
        </View>
        <Text style={styles.title} numberOfLines={1}>{card.title}</Text>
        <MindCharacterBadge mood={card.warnings.length ? 'concerned' : 'happy'} />
      </View>
      <Row label={card.kind === 'swap' ? 'You swap' : 'Amount'} testID="intent-amount">
        <AmountText style={styles.amount}>{amount}</AmountText>
        {!!card.fiat && (
          <AmountText style={styles.sub}>{card.fiat.typed ? '' : '≈ '}{formatFiat(card.fiat.value, card.fiat.currency)}</AmountText>
        )}
      </Row>
      {card.kind === 'swap' && (
        <Row label="You get">
          <AmountText style={styles.value}>
            {card.receive ? `≈ ${card.receive.unit === 'sats' ? formatSats(card.receive.amount, unit) : formatUnits(card.receive.amount, card.receive.unit)}` : 'Quoted on review'}
          </AmountText>
        </Row>
      )}
      {card.kind === 'send' && (
        <Row label="To">
          <Text style={styles.value} numberOfLines={1}>{card.recipient?.name ?? card.recipient?.destination ?? 'Choose on review'}</Text>
          {!!card.recipient?.name && !!card.recipient.destination && advanced && (
            <Text style={styles.sub} numberOfLines={1}>{card.recipient.destination}</Text>
          )}
        </Row>
      )}
      {!!card.route && (advanced || card.kind !== 'send') && (
        <Row label={card.kind === 'send' ? 'Paid from' : card.kind === 'swap' ? 'Provider' : 'Network'}>
          <Text style={styles.value} numberOfLines={1}>{card.route}</Text>
        </Row>
      )}
      <Row label="Estimated fee" testID="intent-fee">
        <AmountText style={styles.value}>{feeText(card, unit)}</AmountText>
      </Row>
      {card.warnings.map((w) => <Callout key={w} tone="warning" message={w} style={styles.callout} />)}
      <Text style={styles.footnote}>Nothing moves until you confirm on the next screen.</Text>
      <View style={styles.buttons}>
        <Button title="Cancel" variant="ghost" size="sm" onPress={onCancel} />
        <Button title="Edit" variant="secondary" size="sm" onPress={onEdit} />
        <Button title="Review" size="sm" onPress={onReview} style={styles.primary} />
      </View>
    </Card>
  );
}

function answerValue(r: AnswerRow, unit: Unit): string {
  if (r.sat != null) return formatSats(r.sat, unit);
  if (r.units != null) return formatUnits(r.units, r.unit ?? '');
  return r.detail ?? '';
}

export function AnswerCardView({ answer, unit, fiatPrice, fiat, onDone }: {
  answer: AnswerCard; unit: Unit; fiatPrice?: number; fiat: string; onDone: () => void;
}) {
  return (
    <Card variant="outlined" style={styles.card} testID="intent-answer-card">
      <View style={styles.header}>
        <Text style={styles.title}>{answer.title}</Text>
        <MindCharacterBadge mood="happy" />
      </View>
      {answer.totalSat != null && (
        <View style={styles.total}>
          <AmountText style={styles.totalAmount}>{formatSats(answer.totalSat, unit)}</AmountText>
          {!!fiatPrice && <AmountText style={styles.sub}>≈ {formatFiat((answer.totalSat / 1e8) * fiatPrice, fiat)}</AmountText>}
        </View>
      )}
      {answer.rows.map((r) => (
        <Row key={r.label} label={r.label}><AmountText style={styles.value}>{answerValue(r, unit)}</AmountText></Row>
      ))}
      {!!answer.note && <Text style={styles.footnote}>{answer.note}</Text>}
      <View style={styles.buttons}>
        <Button title="Done" variant="secondary" size="sm" onPress={onDone} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[4], gap: theme.spacing[2] },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], marginBottom: theme.spacing[1] },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing[3], paddingVertical: theme.spacing[1] },
  rowLabel: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  rowValue: { flexShrink: 1, alignItems: 'flex-end' },
  value: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, textAlign: 'right' },
  amount: { fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  sub: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.tertiary, textAlign: 'right' },
  total: { paddingVertical: theme.spacing[1] },
  totalAmount: { fontSize: theme.typography.fontSize['2xl'], fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  callout: { marginTop: theme.spacing[1] },
  footnote: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: theme.spacing[1] },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing[2], marginTop: theme.spacing[2] },
  primary: { minWidth: 96 },
});
