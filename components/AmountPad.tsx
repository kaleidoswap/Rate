import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { feedback } from '../utils/feedback';

/** The most integer digits a composed amount may carry. */
const MAX_INTEGER_DIGITS = 12;

/**
 * Composes one keypad key into a decimal string, or applies backspace.
 * Invalid compositions (a second decimal point, too many decimals) are
 * ignored, so the string the caller holds is always a plain non-negative
 * decimal — no minus signs, letters or formats to sanitize later.
 */
export function composeAmountKey(value: string, key: string, maxDecimals: number): string {
  if (key === 'back') return value.slice(0, -1);
  if (key === '.') {
    if (maxDecimals <= 0 || value.includes('.')) return value;
    return (value || '0') + '.';
  }
  // Only digits after the point count against the decimal budget.
  const dot = value.indexOf('.');
  if (dot !== -1 && value.length - dot - 1 >= maxDecimals) return value;
  if (dot === -1 && value.replace(/^0+/, '').length >= MAX_INTEGER_DIGITS) return value;
  if (value === '0') return key;
  return (value || '') + key;
}

/** Groups the integer part of a composed amount the way it is displayed. */
export function groupComposedAmount(value: string): string {
  const dot = value.indexOf('.');
  const int = dot === -1 ? value : value.slice(0, dot);
  const rest = dot === -1 ? '' : value.slice(dot);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return grouped + rest;
}

const ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['.', '0', 'back']];
const keyLabel = (k: string) => (k === '.' ? 'Decimal point' : k === 'back' ? 'Backspace' : k);

/**
 * The wallet's own number keys: big targets, a tick of haptics each press, a
 * decimal point only where one belongs (never in sats), and a backspace.
 * The composition rules live in composeAmountKey, shared with the tests.
 */
export function AmountPad({ value, onChange, maxDecimals = 0 }: { value: string; onChange: (next: string) => void; maxDecimals?: number }) {
  const t = useAppTheme();
  const press = (key: string) => {
    feedback.tap();
    const next = composeAmountKey(value, key, maxDecimals);
    if (next !== value) onChange(next);
  };
  return <View style={{ gap: t.spacing[2] }} accessibilityLabel="Amount keypad">
    {ROWS.map((row, i) => (
      <View key={i} style={{ flexDirection: 'row', gap: t.spacing[2] }}>
        {row.map(k => {
          if (k === '.' && maxDecimals <= 0) return <View key={k} style={{ flex: 1, minHeight: 52 }} />;
          return <Pressable key={k} accessibilityRole="button" accessibilityLabel={keyLabel(k)} onPress={() => press(k)}
            style={({ pressed }) => ({ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center',
              borderRadius: t.borderRadius.lg, backgroundColor: pressed ? t.colors.surface.secondary : t.colors.surface.primary,
              borderWidth: 1, borderColor: pressed ? t.colors.primary[500] : t.colors.border.light, opacity: pressed ? 0.7 : 1 })}>
            {k === 'back'
              ? <Ionicons name="backspace-outline" size={22} color={value ? t.colors.text.primary : t.colors.text.muted} />
              : <Text style={{ fontSize: t.typography.fontSize['2xl'], fontWeight: '600', color: t.colors.text.primary, fontVariant: ['tabular-nums'] }}>{k}</Text>}
          </Pressable>;
        })}
      </View>
    ))}
  </View>;
}
