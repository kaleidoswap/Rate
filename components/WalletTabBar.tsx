import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';

/** Stable, in-flow navigation keeps every screen above the home indicator. */
export function WalletTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const renderItem = (route: typeof state.routes[number], index: number) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const color = focused ? theme.colors.primary[500] : theme.colors.text.secondary;
    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={String(options.tabBarLabel ?? route.name)}
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        style={tabStyles.item}
      >
        {options.tabBarIcon?.({ focused, color, size: 22 })}
        <Text style={[tabStyles.label, { color }]}>{String(options.tabBarLabel ?? route.name)}</Text>
      </TouchableOpacity>
    );
  };
  return (
    <View style={[tabStyles.bar, {
      paddingBottom: Math.max(insets.bottom, theme.spacing[2]),
      backgroundColor: theme.colors.surface.primary,
      borderTopColor: theme.colors.border.light,
    }]}>
      {state.routes.slice(0, 2).map((r, i) => renderItem(r, i))}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Scan a payment QR code"
        onPress={() => navigation.navigate('QRScanner')}
        style={tabStyles.item}
      >
        <View style={[tabStyles.scan, { backgroundColor: theme.colors.primary[500] }]}>
          <Ionicons name="scan" size={24} color={theme.colors.text.inverse} />
        </View>
        <Text style={[tabStyles.label, { color: theme.colors.text.primary }]}>Scan</Text>
      </TouchableOpacity>
      {state.routes.slice(2).map((r, i) => renderItem(r, i + 2))}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing[2], paddingHorizontal: theme.spacing[2],
  },
  item: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: theme.spacing[1] },
  label: { fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold },
  scan: { width: 44, height: 36, borderRadius: theme.borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
});

