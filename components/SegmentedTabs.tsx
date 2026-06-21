// components/SegmentedTabs.tsx
//
// A horizontal row of selectable pills — used for filters (History), venue
// pickers (Swap), network selectors (Receive). Replaces the per-screen
// hand-rolled TouchableOpacity strips, and ships the accessibility the
// inline versions were missing (role="tab" + selected state + haptic tick).
import React from 'react';
import { ScrollView, View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';
import { PressableScale } from './PressableScale';

export interface SegmentOption<T extends string = string> {
  key: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SegmentedTabsProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (key: T) => void;
  /** Horizontal scroll when the options overflow (default true). */
  scrollable?: boolean;
  /** Stretch options to fill the width evenly (only when not scrollable). */
  fill?: boolean;
  style?: ViewStyle;
}

export function SegmentedTabs<T extends string = string>({
  options,
  value,
  onChange,
  scrollable = true,
  fill = false,
  style,
}: SegmentedTabsProps<T>) {
  const row = (
    <View style={[styles.row, fill && !scrollable && styles.rowFill]}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <PressableScale
            key={opt.key}
            onPress={() => {
              if (!active) feedback.select();
              onChange(opt.key);
            }}
            style={[
              styles.tab,
              fill && !scrollable && styles.tabFill,
              active ? styles.tabActive : styles.tabInactive,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            {opt.icon && (
              <Ionicons
                name={opt.icon}
                size={14}
                color={active ? theme.colors.text.inverse : theme.colors.text.secondary}
                style={styles.tabIcon}
              />
            )}
            <Text style={[styles.tabText, active ? styles.tabTextActive : styles.tabTextInactive]}>
              {opt.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );

  if (!scrollable) {
    return <View style={style}>{row}</View>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={style}
    >
      {row}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingRight: theme.spacing[4],
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing[2],
  },
  rowFill: {
    flex: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    minHeight: 36,
  },
  tabFill: {
    flex: 1,
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[500],
  },
  tabInactive: {
    backgroundColor: theme.colors.surface.secondary,
    borderColor: theme.colors.border.light,
  },
  tabIcon: {
    marginRight: 5,
  },
  tabText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  tabTextActive: {
    color: theme.colors.text.inverse,
  },
  tabTextInactive: {
    color: theme.colors.text.secondary,
  },
});

export default SegmentedTabs;
