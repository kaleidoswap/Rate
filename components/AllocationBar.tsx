import React from 'react';
import { View, Text } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';
export type Allocation = { label: string; value: number; color: string };
/** A snapshot of reported holdings, never a historical performance chart. */
export function AllocationBar({ items, hideAmounts = false }: { items: Allocation[]; hideAmounts?: boolean }) {
  const t = useAppTheme();
  const positive = items.filter(i => Number.isFinite(i.value) && i.value > 0);
  const total = positive.reduce((n, i) => n + i.value, 0);
  if (!total || hideAmounts) return null;
  return <View style={{ gap: t.spacing[2], marginBottom: t.spacing[3] }}>
    <View accessible accessibilityLabel={positive.map(i => `${i.label}: ${Math.round(i.value / total * 100)} percent`).join(', ')}
      style={{ height: t.spacing[2], flexDirection: 'row', gap: t.spacing[0.5], overflow: 'hidden', borderRadius: t.borderRadius.full }}>
      {positive.map((i, index) => <View key={`${i.label}-${index}`} style={{ flex: i.value / total, backgroundColor: i.color }} />)}
    </View>
    <Text style={{ fontSize: t.typography.fontSize.xs, color: t.colors.text.tertiary }}>Current allocation · {positive.length} {positive.length === 1 ? 'location' : 'locations'}</Text>
  </View>;
}
