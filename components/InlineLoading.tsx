import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

interface InlineLoadingProps {
  size?: 'small' | 'medium' | 'large';
  message?: string;
  showIcon?: boolean;
  variant?: 'default' | 'card' | 'subtle';
}

export const InlineLoading: React.FC<InlineLoadingProps> = ({
  size = 'medium',
  message,
  showIcon = false,
  variant = 'default',
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnimation.start();

    return () => pulseAnimation.stop();
  }, []);

  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return {
          spinnerSize: 16,
          fontSize: theme.typography.fontSize.sm,
          spacing: theme.spacing[2],
          containerPadding: theme.spacing[3],
        };
      case 'large':
        return {
          spinnerSize: 32,
          fontSize: theme.typography.fontSize.lg,
          spacing: theme.spacing[4],
          containerPadding: theme.spacing[6],
        };
      default: // medium
        return {
          spinnerSize: 24,
          fontSize: theme.typography.fontSize.base,
          spacing: theme.spacing[3],
          containerPadding: theme.spacing[4],
        };
    }
  };

  const config = getSizeConfig();

  const getContainerStyle = () => {
    switch (variant) {
      case 'card':
        return [
          styles.container,
          styles.cardContainer,
          { padding: config.containerPadding },
        ];
      case 'subtle':
        return [
          styles.container,
          styles.subtleContainer,
          { padding: config.containerPadding },
        ];
      default:
        return [
          styles.container,
          { padding: config.containerPadding },
        ];
    }
  };

  return (
    <Animated.View
      style={[
        getContainerStyle(),
        {
          opacity: fadeAnim,
        },
      ]}
    >
      {showIcon && (
        <Animated.View
          style={[
            styles.iconContainer,
            {
              transform: [{ scale: pulseAnim }],
              marginRight: message ? config.spacing : 0,
            },
          ]}
        >
          <View style={[styles.iconBackground, { width: config.spinnerSize + 8, height: config.spinnerSize + 8 }]}>
            <Ionicons name="refresh" size={config.spinnerSize - 4} color={theme.colors.primary[500]} />
          </View>
        </Animated.View>
      )}
      
      <View style={[styles.loadingContent, { gap: config.spacing }]}>
        <ActivityIndicator 
          size={size === 'small' ? 'small' : 'large'} 
          color={theme.colors.primary[500]} 
        />
        {message && (
          <Text style={[styles.message, { fontSize: config.fontSize }]}>
            {message}
          </Text>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.shadows.sm,
  },
  subtleContainer: {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.base,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBackground: {
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  message: {
    color: theme.colors.text.secondary,
    fontWeight: '500',
    textAlign: 'center',
  },
});

// Skeleton loading component for list items
export const SkeletonLoader: React.FC<{
  lines?: number;
  width?: string;
  height?: number;
}> = ({ lines = 3, width = '100%', height = 16 }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const shimmerAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    shimmerAnimation.start();

    return () => shimmerAnimation.stop();
  }, []);

  return (
    <View style={skeletonStyles.container}>
      {Array.from({ length: lines }).map((_, index) => (
        <Animated.View
          key={index}
                      style={[
            skeletonStyles.line,
            {
              width: index === lines - 1 ? '70%' : width as any,
              height,
              opacity: shimmerAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 0.7],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
};

const skeletonStyles = StyleSheet.create({
  container: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  line: {
    backgroundColor: theme.colors.gray[200],
    borderRadius: theme.borderRadius.sm,
  },
});

export default InlineLoading; 