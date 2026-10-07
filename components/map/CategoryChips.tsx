// components/map/CategoryChips.tsx
import React, { memo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { CategoryFilter, PLACE_CATEGORIES } from '../../utils/btcMapPlaces';
import { CATEGORY_COLOR } from './categoryStyle';

interface Props {
  value: CategoryFilter;
  counts: Record<CategoryFilter, number>;
  onChange: (c: CategoryFilter) => void;
  /** Drawn over the map: solid chips with a shadow so they read on any tile. */
  floating?: boolean;
}

const CHIPS: { id: CategoryFilter; label: string; icon: string; color: string }[] = [
  { id: 'all', label: 'All', icon: 'apps', color: theme.colors.primary[500] },
  ...PLACE_CATEGORIES.map((c) => ({ ...c, color: CATEGORY_COLOR[c.id] })),
];

export const CategoryChips = memo(function CategoryChips({ value, counts, onChange, floating }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {CHIPS.filter((c) => c.id === 'all' || c.id === value || counts[c.id] > 0).map((c) => {
        const on = c.id === value;
        return (
          <TouchableOpacity
            key={c.id}
            onPress={() => onChange(on && c.id !== 'all' ? 'all' : c.id)}
            style={[styles.chip, floating && styles.floating, on && { backgroundColor: floating ? theme.colors.surface.elevated : c.color + '26', borderColor: c.color }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${c.label}, ${counts[c.id] ?? 0} places`}
          >
            <Ionicons name={(on ? c.icon : `${c.icon}-outline`) as any} size={14} color={on ? c.color : theme.colors.text.secondary} />
            <Text style={[styles.label, on && { color: theme.colors.text.primary }]}>{c.label}</Text>
            <Text style={[styles.count, on && { color: c.color }]}>{counts[c.id] ?? 0}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.elevated,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
  },
  floating: {
    backgroundColor: theme.colors.surface.primary,
    ...theme.shadows.md,
  },
  label: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  count: {
    color: theme.colors.text.tertiary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    fontVariant: ['tabular-nums'],
  },
});
