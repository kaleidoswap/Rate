import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';

export interface SwapRouteSummaryProps {
  provider: string;
  route: string;
  fee: string;
  rate: string;
  secondsLeft: number | null;
  offerCount: number;
  onCompare: () => void;
}

/** Essential terms stay visible; secondary quote details expand in place. */
export function SwapRouteSummary({ provider, route, fee, rate, secondsLeft, offerCount, onCompare }: SwapRouteSummaryProps) {
  const t = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const styles = StyleSheet.create({
    card: { backgroundColor: t.colors.surface.primary, borderRadius: t.borderRadius['2xl'], padding: t.spacing[4], gap: t.spacing[3] },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing[3], flexWrap: 'wrap' },
    label: { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm },
    value: { color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600', flexShrink: 1 },
    action: { minHeight: 44, justifyContent: 'center' },
    link: { color: t.colors.primary[500], fontSize: t.typography.fontSize.sm, fontWeight: '600' },
    details: { gap: t.spacing[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border.light, paddingTop: t.spacing[3] },
  });
  return <View style={styles.card}>
    <View style={styles.row}>
      <View style={{ flex: 1 }}><Text style={styles.value}>{provider}</Text><Text style={styles.label}>{route}</Text></View>
      {offerCount > 1 && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Compare swap providers" style={styles.action} onPress={onCompare}><Text style={styles.link}>Compare ({offerCount})</Text></TouchableOpacity>}
    </View>
    <View style={styles.row}><Text style={styles.label}>Swap fee</Text><Text style={styles.value}>{fee}</Text></View>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.action}>
      <Text style={styles.link}>{expanded ? 'Hide quote details' : 'Quote details'}</Text>
    </TouchableOpacity>
    {expanded && <View style={styles.details}>
      <Text style={styles.value}>{rate}</Text>
      <Text style={styles.label}>{secondsLeft == null ? 'Checking quote expiry…' : secondsLeft > 0 ? `Quote valid for ${secondsLeft}s` : 'Quote expired — refresh before confirming'}</Text>
    </View>}
  </View>;
}
