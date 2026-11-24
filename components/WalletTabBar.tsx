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
  const scanIndex = Math.ceil(state.routes.length / 2);
  const renderItem = (route: typeof state.routes[number], index: number) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const color = focused ? theme.colors.primary[500] : theme.colors.text.secondary;
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
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
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
      paddingBottom: Math.max(insets.bottom, theme.spacing[2]),
      paddingLeft: insets.left + theme.spacing[2],
      paddingRight: insets.right + theme.spacing[2],
    }]}>
      <View style={tabStyles.side}>
        {state.routes.slice(0, scanIndex).map(renderItem)}
      </View>
      <TouchableOpacity
        accessible
        accessibilityRole="button"
        accessibilityLabel={language === 'it' ? 'Scansiona un codice QR di pagamento' : 'Scan a payment QR code'}
        onPress={() => navigation.navigate('QRScanner')}
        style={[tabStyles.item, tabStyles.scanItem]}
      >
        <View style={[tabStyles.iconWrap, tabStyles.scan]}>
          <Ionicons name="scan" size={24} color={theme.colors.text.inverse} />
        </View>
        <Text style={[tabStyles.label, { color: theme.colors.text.primary }]}>{t('Scan')}</Text>
      </TouchableOpacity>
      <View style={tabStyles.side}>
        {state.routes.slice(scanIndex).map((r, i) => renderItem(r, i + scanIndex))}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing[1],
    paddingTop: theme.spacing[2],
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
  },
  side: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  iconWrap: {
    position: 'relative',
    width: theme.spacing[12],
    maxWidth: '100%',
    height: theme.spacing[8],
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: theme.colors.primary[100] },
  badge: {
    position: 'absolute',
    top: -theme.spacing[0.5],
    right: -theme.spacing[1],
    minWidth: theme.spacing[4],
    minHeight: theme.spacing[4],
    paddingHorizontal: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.error[500],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: theme.colors.text.inverse,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.bold,
  },
  label: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    textAlign: 'center',
  },
  scanItem: { flex: 0, width: theme.spacing[16] },
  scan: { width: theme.spacing[14], backgroundColor: theme.colors.primary[500] },
});
