// components/FilterChips.tsx
//
// Filter building blocks shared by list screens (Activity first):
// - FilterButton: a 44pt icon button for a screen header, with a count badge
//   when filters are active.
// - FilterChipGroup: a labelled, wrapping group of single-select chips for a
//   filter sheet.
// - ActiveFilterBar: the active filters as removable chips under the header.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../theme';

const CHIP_HEIGHT = 36;
// Chips are 36pt tall; the slop makes each one a 44pt touch target.
const CHIP_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

export function FilterButton({ activeCount, onPress, style }: { activeCount: number; onPress: () => void; style?: ViewStyle }) {
  const active = activeCount > 0;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={active ? `Filters, ${activeCount} active` : 'Filters'}
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.filterButton, active && styles.filterButtonActive, style]}
    >
      <Ionicons name="options-outline" size={20} color={active ? theme.colors.primary[500] : theme.colors.text.primary} />
      {active && (
        <View style={styles.countBadge} pointerEvents="none">
          <Text style={styles.countText}>{activeCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export interface FilterOption<K extends string> {
  key: K;
  label: string;
  renderIcon?: (color: string, size: number) => React.ReactNode;
}

export function FilterChip({ label, selected, onPress, icon, accessibilityLabel }: {
  label: string; selected: boolean; onPress: () => void; icon?: React.ReactNode; accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={CHIP_SLOP}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {selected && <Ionicons name="checkmark" size={14} color={theme.colors.primary[500]} />}
      {icon}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

export function FilterChipGroup<K extends string>({ label, options, value, onChange }: {
  label: string; options: FilterOption<K>[]; value: K; onChange: (key: K) => void;
}) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((o) => {
          const selected = o.key === value;
          return (
            <FilterChip key={o.key} label={o.label} selected={selected} onPress={() => onChange(o.key)}
              icon={o.renderIcon?.(selected ? theme.colors.primary[500] : theme.colors.text.secondary, 14)} />
          );
        })}
      </View>
    </View>
  );
}

export interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

export function ActiveFilterBar({ filters, onClearAll }: { filters: ActiveFilter[]; onClearAll: () => void }) {
  if (filters.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      style={styles.activeBar} contentContainerStyle={styles.activeBarContent}>
      {filters.map((f) => (
        <TouchableOpacity key={f.key} accessibilityRole="button" accessibilityLabel={`Remove filter ${f.label}`}
          onPress={f.onRemove} activeOpacity={0.7} hitSlop={CHIP_SLOP} style={[styles.chip, styles.activeChip]}>
          <Text style={[styles.chipText, styles.chipTextSelected]} numberOfLines={1}>{f.label}</Text>
          <Ionicons name="close" size={14} color={theme.colors.primary[500]} />
        </TouchableOpacity>
      ))}
      {filters.length > 1 && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear all filters" onPress={onClearAll}
          activeOpacity={0.7} hitSlop={CHIP_SLOP} style={styles.clearAll}>
          <Text style={styles.clearAllText}>Clear all</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  filterButtonActive: {
    borderColor: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[500] + '1A',
  },
  countBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary[500],
    borderWidth: 2,
    borderColor: theme.colors.background.secondary,
  },
  countText: {
    color: theme.colors.text.inverse,
    fontSize: 10,
    lineHeight: leading(10, theme.typography.lineHeight.tight),
    fontWeight: '700',
  },
  group: {
    gap: theme.spacing[2],
  },
  groupLabel: {
    color: theme.colors.text.tertiary,
    fontSize: theme.typography.fontSize.xs,
    lineHeight: leading(theme.typography.fontSize.xs),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  chipSelected: {
    backgroundColor: theme.colors.primary[500] + '1F',
    borderColor: theme.colors.primary[500],
  },
  chipText: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.tight),
    fontWeight: '600',
  },
  chipTextSelected: {
    color: theme.colors.primary[500],
  },
  activeBar: {
    flexGrow: 0,
  },
  activeBarContent: {
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  activeChip: {
    backgroundColor: theme.colors.primary[500] + '1F',
    borderColor: 'transparent',
    minHeight: CHIP_HEIGHT,
    paddingRight: theme.spacing[2],
  },
  clearAll: {
    minHeight: CHIP_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[2],
  },
  clearAllText: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.tight),
    fontWeight: '600',
  },
});
