import { useAppLanguage } from '../localization/useAppLanguage';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAppTheme } from '../theme/ThemeProvider';
import { usePendingPaymentsCount } from '../hooks/usePendingPaymentsCount';

/** Stable, in-flow navigation keeps every screen above the home indicator. */
export function WalletTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { language, t } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const tabStyles = makeStyles(theme);
  const pending = usePendingPaymentsCount();
  const renderItem = (route: typeof state.routes[number], index: number) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const color = focused ? theme.colors.text.primary : theme.colors.text.secondary;
    const label = t(String(options.tabBarLabel ?? route.name));
    // Payments waiting for a check surface on the Activity tab; the badge says how many.
    const badge = route.name === 'Activity' ? pending : 0;
    const attention = language === 'it'
      ? (badge === 1 ? '1 pagamento da verificare' : `${badge} pagamenti da verificare`)
      : (badge === 1 ? '1 payment needs attention' : `${badge} payments need attention`);
    return (
      <TouchableOpacity
        key={route.key}
        accessible
        accessibilityRole="tab"
        accessibilityLabel={badge ? `${label}, ${attention}` : label}
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        style={tabStyles.item}
      >
        <View style={[tabStyles.iconWrap, focused && tabStyles.selected]}>
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
      paddingLeft: insets.left + theme.spacing[2],
      paddingRight: insets.right + theme.spacing[2],
    }]}>
      {state.routes.slice(0, 2).map((r, i) => renderItem(r, i))}
      <TouchableOpacity
        accessible
        accessibilityRole="button"
        accessibilityLabel={language === 'it' ? 'Scansiona un codice QR di pagamento' : 'Scan a payment QR code'}
        onPress={() => navigation.navigate('QRScanner')}
        style={tabStyles.item}
      >
        <View style={[tabStyles.iconWrap, tabStyles.scan]}>
          <Ionicons name="scan" size={24} color={theme.colors.text.inverse} />
        </View>
        <Text style={[tabStyles.label, { color: theme.colors.text.primary }]}>{t('Scan')}</Text>
      </TouchableOpacity>
      {state.routes.slice(2).map((r, i) => renderItem(r, i + 2))}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'stretch', borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing[1.5],
    backgroundColor: theme.colors.surface.primary, borderTopColor: theme.colors.border.light,
  },
  item: { flex: 1, minHeight: 48, alignItems: 'center', gap: theme.spacing[0.5] },
  iconWrap: {
    position: 'relative', width: theme.spacing[12], maxWidth: '100%', height: theme.spacing[8],
    borderRadius: theme.borderRadius.lg, alignItems: 'center', justifyContent: 'center',
  },
  selected: { backgroundColor: theme.colors.primary[100] },
  badge: {
    position: 'absolute', top: 0, right: -theme.spacing[1],
    minWidth: theme.spacing[4], paddingHorizontal: theme.spacing[1], borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.error[500], alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: theme.colors.text.inverse, fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.bold },
  label: { fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, textAlign: 'center' },
  scan: { backgroundColor: theme.colors.primary[500] },
});
