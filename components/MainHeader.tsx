import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme';

interface MainHeaderProps {
  title?: string;
  subtitle?: string;
  greeting?: string;
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
  showNotification,
  showSettings,
  rightAction,
  icon,
  onBack,
  children,
}) => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.gradient, { paddingTop: insets.top + 8, backgroundColor: theme.colors.background.primary }]}>
        <View style={styles.content}>
          <View style={styles.row}>
            {onBack && (
              <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </TouchableOpacity>
            )}

            <View style={styles.titleArea}>
              {greeting && <Text style={styles.greeting}>{greeting}</Text>}
              <View style={styles.titleRow}>
                {icon && <Ionicons name={icon} size={22} color="#fff" style={{ marginRight: 8, opacity: 0.9 }} />}
                {title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
              </View>
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>

            <View style={styles.actions}>
              {rightAction}
              {showNotification && (
                <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Notifications')}>
                  <Ionicons name="notifications-outline" size={18} color="#fff" />
                  <View style={styles.dot} />
                </TouchableOpacity>
              )}
              {showSettings && (
                <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Settings')}>
                  <Ionicons name="ellipsis-horizontal" size={18} color="#fff" />
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
    overflow: 'hidden',
  },
  gradient: {
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  content: {
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  titleArea: {
    flex: 1,
  },
  greeting: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 12,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  childrenArea: {
    marginTop: 16,
  },
});
