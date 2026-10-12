import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from './Input';
import { useAppTheme } from '../theme/ThemeProvider';
export function ActivitySearchControls({ query, activeCount, onQuery, onOpenFilters }: {
  query: string; activeCount: number; onQuery: (value: string) => void; onOpenFilters: () => void;
}) {
  const t = useAppTheme();
  return <View style={{ paddingHorizontal: t.spacing[4], gap: t.spacing[2], paddingBottom: t.spacing[2] }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
      <Input style={{ flex: 1 }} size="sm" value={query} onChangeText={onQuery} autoCorrect={false} autoCapitalize="none"
        accessibilityLabel="Search activity" placeholder="Name, amount or reference" returnKeyType="search"
        leftIcon={<Ionicons name="search" size={18} color={t.colors.text.secondary} />}
        rightIcon={query ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onQuery('')} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="close-circle" size={18} color={t.colors.text.secondary} /></TouchableOpacity> : undefined} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={activeCount ? `Filters, ${activeCount} active` : 'Filters'} onPress={onOpenFilters} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 10, gap: 5, flexDirection: 'row', borderRadius: t.borderRadius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface.primary }}>
        <Ionicons name="options-outline" size={20} color={activeCount ? t.colors.primary[500] : t.colors.text.secondary} />
        {activeCount > 0 && <Text style={{ color: t.colors.primary[500], fontWeight: '600' }}>{activeCount}</Text>}
      </TouchableOpacity>
    </View>
  </View>;
}
