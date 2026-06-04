import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme';
import { BrandMark } from './BrandMark';

interface MainHeaderProps {
  title?: string;
  subtitle?: string;
  greeting?: string;
  /** Show the KaleidoSwap mark before the title (defaults on when a greeting is set). */
  showLogo?: boolean;
  showNotification?: boolean;
  showSettings?: boolean;
  rightAction?: React.ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  onBack?: () => void;
  children?: React.ReactNode;
}

export const MainHeader: React.FC<MainHeaderProps> = ({
  title,
  subtitle,
  greeting,
  showLogo,
  showNotification,
  showSettings,
  rightAction,
  icon,
  onBack,
  children,
}) => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const withLogo = showLogo ?? !!greeting;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
        <View style={styles.content}>
          <View style={styles.row}>
            {onBack && (
              <TouchableOpacity
                onPress={onBack}
                style={styles.iconBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="arrow-back" size={20} color={theme.colors.text.primary} />
              </TouchableOpacity>
            )}

            <View style={styles.titleArea}>
              {greeting && <Text style={styles.greeting}>{greeting}</Text>}
              <View style={styles.titleRow}>
                {withLogo && <BrandMark size={24} />}
                {icon && !withLogo && (
                  <Ionicons name={icon} size={20} color={theme.colors.text.primary} style={{ marginRight: 8, opacity: 0.9 }} />
                )}
                {title && (
                  <Text style={styles.title} numberOfLines={1}>
                    {title}
                  </Text>
                )}
              </View>
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>

            <View style={styles.actions}>
              {rightAction}
              {showNotification && (
                <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Notifications')}>
                  <Ionicons name="notifications-outline" size={18} color={theme.colors.text.secondary} />
                  <View style={styles.dot} />
                </TouchableOpacity>
              )}
              {showSettings && (
                <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Settings')}>
                  <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.text.secondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {children && <View style={styles.childrenArea}>{children}</View>}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background.primary,
  },
  bar: {
    paddingBottom: 16,
    backgroundColor: theme.colors.background.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  content: {
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 12,
  },
  titleArea: {
    flex: 1,
  },
  greeting: {
    fontSize: 13,
    color: theme.colors.text.secondary,
    marginBottom: 3,
    fontWeight: '500',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: theme.colors.text.primary,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginTop: 3,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 0,
  },
  dot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.colors.error[500],
    borderWidth: 1.5,
    borderColor: theme.colors.background.primary,
  },
  childrenArea: {
    marginTop: 16,
  },
});
