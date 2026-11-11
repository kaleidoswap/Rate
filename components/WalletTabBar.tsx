import { useAppLanguage } from '../localization/useAppLanguage';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';
import { usePendingPaymentsCount } from '../hooks/usePendingPaymentsCount';

/** Stable, in-flow navigation keeps every screen above the home indicator. */
export function WalletTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const pending = usePendingPaymentsCount();
  const renderItem = (route: typeof state.routes[number], index: number) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const color = focused ? theme.colors.primary[500] : theme.colors.text.secondary;
    const label = t(String(options.tabBarLabel ?? route.name));
    // Payments waiting for a check surface on the Activity tab; the badge says how many.
    const badge = route.name === 'Activity' ? pending : 0;
    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={`${label}${badge ? `, ${badge} ${badge === 1 ? 'payment needs attention' : 'payments need attention'}` : ''}`}
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        style={tabStyles.item}
      >
        <View style={tabStyles.iconWrap}>
          {options.tabBarIcon?.({ focused, color, size: 22 })}
          {!!badge && (
            <View style={tabStyles.badge}>
              <Text style={tabStyles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          )}
        </View>
        <Text style={[tabStyles.label, { color }]}>{label}</Text>
      </TouchableOpacity>
    );
  };
  return (
    <View style={[tabStyles.bar, {
      // The home indicator sits in the lower part of the inset, so the full
      // 34pt inset under the labels read as dead space. Labels may sit within
      // its top portion; keep at least 8pt on devices without one.
      paddingBottom: insets.bottom > 0 ? Math.max(insets.bottom - 16, theme.spacing[2]) : theme.spacing[2],
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
        <Text style={[tabStyles.label, { color: theme.colors.text.primary }]}>{t('Scan')}</Text>
      </TouchableOpacity>
      {state.routes.slice(2).map((r, i) => renderItem(r, i + 2))}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing[1.5], paddingHorizontal: theme.spacing[2],
  },
  item: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -5, right: -14,
    minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.error[500], alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: theme.colors.text.inverse, fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.bold },
  label: { fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold },
  scan: { width: 44, height: 32, borderRadius: theme.borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
});
