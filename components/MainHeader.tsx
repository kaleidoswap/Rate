import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';
import { BrandMark } from './BrandMark';
import { BrandLogo } from './brand/BrandLogo';

interface MainHeaderProps {
  title?: string;
  subtitle?: string;
  greeting?: string;
  /** Show the KaleidoSwap mark before the title (defaults on when a greeting is set). */
  showLogo?: boolean;
  /** Render the full horizontal KaleidoSwap logo (extension parity) instead of greeting/title. */
  brandLogo?: boolean;
  showNotification?: boolean;
  showSettings?: boolean;
  rightAction?: React.ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  onBack?: () => void;
  children?: React.ReactNode;
  /**
   * Give the header a downward shadow (and drop the bottom hairline) so content
   * scrolling beneath a sticky header reads as passing under it. Off by default
   * so other screens that embed MainHeader inline are unaffected.
   */
  elevated?: boolean;
}

export const MainHeader: React.FC<MainHeaderProps> = ({
  title,
  subtitle,
  greeting,
  showLogo,
  brandLogo,
  showNotification,
  showSettings,
  rightAction,
  icon,
  onBack,
  children,
  elevated,
}) => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const withLogo = showLogo ?? !!greeting;

  return (
    <View style={[styles.container, elevated && styles.containerElevated]}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.bar, elevated && styles.barElevated, { paddingTop: insets.top + 4 }]}>
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
              {brandLogo ? (
                <BrandLogo height={36} />
              ) : (
                <>
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
                </>
              )}
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
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => navigation.navigate('Settings')}
                  accessibilityLabel="Settings"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="settings-outline" size={19} color={theme.colors.text.primary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {children && <View style={styles.childrenArea}>{children}</View>}
        </View>
      </View>
      {elevated && (
        <LinearGradient
          colors={['rgba(0,0,0,0.22)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          pointerEvents="none"
          style={styles.shadowStrip}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background.primary,
  },
  containerElevated: {
    // Downward shadow so scroll content appears to pass beneath a sticky header.
    // Tuned to mirror the extension header's `box-shadow: 0 10px 24px rgba(0,0,0,0.22)`.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 10,
  },
  bar: {
    paddingBottom: theme.spacing[3],
    backgroundColor: theme.colors.background.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  barElevated: {
    // The shadow alone conveys depth — drop the hairline so it doesn't double up.
    borderBottomWidth: 0,
  },
  content: {
    paddingHorizontal: theme.spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: theme.spacing[3],
  },
  titleArea: {
    flex: 1,
  },
  greeting: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: 3,
    fontWeight: theme.typography.fontWeight.medium,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  title: {
    fontSize: 21,
    fontWeight: theme.typography.fontWeight.bold,
    letterSpacing: -0.3,
    color: theme.colors.text.primary,
  },
  subtitle: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    marginTop: 3,
    fontWeight: theme.typography.fontWeight.medium,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
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
    marginTop: theme.spacing[4],
  },
  shadowStrip: {
    // Cross-platform gradient "shadow" spilling below the header, since RN
    // native box-shadows are unreliable on Android.
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    height: 16,
  },
});
