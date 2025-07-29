import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

const { width, height } = Dimensions.get('window');
const statusBarHeight = StatusBar.currentHeight || 0;

interface LoadingScreenProps {
  variant?: 'app' | 'connection' | 'minimal';
  title?: string;
  subtitle?: string;
  showProgress?: boolean;
  progress?: number;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  variant = 'app',
  title,
  subtitle,
  showProgress = false,
  progress = 0,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Immediate fade in animation (no delay)
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 0,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Remove pulse animation to eliminate delays
    // const pulseAnimation = Animated.loop(
    //   Animated.sequence([
    //     Animated.timing(pulseAnim, {
    //       toValue: 1.1,
    //       duration: 1500,
    //       useNativeDriver: true,
    //     }),
    //     Animated.timing(pulseAnim, {
    //       toValue: 1,
    //       duration: 1500,
    //       useNativeDriver: true,
    //     }),
    //   ])
    // );
    // pulseAnimation.start();

    // return () => pulseAnimation.stop();
  }, []);

  // Progress animation (immediate)
  useEffect(() => {
    if (showProgress) {
      Animated.timing(progressAnim, {
        toValue: progress,
        duration: 0,
        useNativeDriver: false,
      }).start();
    }
  }, [progress, showProgress]);

  if (variant === 'minimal') {
    return (
      <View style={styles.minimalContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary[500]} />
        {title && <Text style={styles.minimalText}>{title}</Text>}
      </View>
    );
  }

  if (variant === 'connection') {
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient
          colors={['#4338ca', '#7c3aed', '#a855f7'] as [string, string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <Animated.View
            style={[
              styles.connectionContent,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            {/* Logo/Icon Section */}
            <Animated.View
              style={[
                styles.logoContainer,
                {
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            >
              <View style={styles.logoBackground}>
                <Ionicons name="flash" size={40} color={theme.colors.text.inverse} />
              </View>
            </Animated.View>

            {/* Loading Content */}
            <View style={styles.textContainer}>
              <Text style={styles.primaryTitle}>
                {title || 'Connecting to Node'}
              </Text>
              <Text style={styles.subtitle}>
                {subtitle || 'Establishing secure connection...'}
              </Text>
            </View>

            {/* Loading Indicator */}
            <View style={styles.loadingSection}>
              <View style={styles.spinnerContainer}>
                <ActivityIndicator size="large" color={theme.colors.text.inverse} />
              </View>
              
              {showProgress && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <Animated.View
                      style={[
                        styles.progressFill,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {Math.round(progress * 100)}%
                  </Text>
                </View>
              )}
            </View>

            {/* Status Dots */}
            <View style={styles.statusDots}>
              {[0, 1, 2].map((index) => (
                <Animated.View
                  key={index}
                  style={[
                    styles.dot,
                    {
                      opacity: fadeAnim,
                    },
                  ]}
                />
              ))}
            </View>
          </Animated.View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // Default 'app' variant
  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={theme.colors.primary.gradient as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Animated.View
          style={[
            styles.appContent,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* App Logo/Branding */}
          <Animated.View
            style={[
              styles.brandContainer,
              {
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <View style={styles.appLogo}>
              <Text style={styles.logoText}>R</Text>
            </View>
            <Text style={styles.appName}>Rate Wallet</Text>
            <Text style={styles.tagline}>RGB Lightning Network</Text>
          </Animated.View>

          {/* Loading Section */}
          <View style={styles.loadingSection}>
            <View style={styles.modernSpinner}>
              <ActivityIndicator size="large" color={theme.colors.text.inverse} />
            </View>
            <Text style={styles.loadingText}>
              {title || 'Initializing Wallet...'}
            </Text>
            {subtitle && (
              <Text style={styles.loadingSubtext}>{subtitle}</Text>
            )}
          </View>

          {/* Feature Highlights */}
          <View style={styles.featuresContainer}>
            <View style={styles.feature}>
              <Ionicons name="shield-checkmark" size={16} color="rgba(255, 255, 255, 0.8)" />
              <Text style={styles.featureText}>Secure</Text>
            </View>
            <View style={styles.feature}>
              <Ionicons name="flash" size={16} color="rgba(255, 255, 255, 0.8)" />
              <Text style={styles.featureText}>Lightning Fast</Text>
            </View>
            <View style={styles.feature}>
              <Ionicons name="diamond" size={16} color="rgba(255, 255, 255, 0.8)" />
              <Text style={styles.featureText}>RGB Assets</Text>
            </View>
          </View>
        </Animated.View>
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: Platform.OS === 'android' ? statusBarHeight : 0,
  },
  
  // App variant styles
  appContent: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    width: '100%',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  appLogo: {
    width: 80,
    height: 80,
    borderRadius: theme.borderRadius['2xl'],
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[4],
    ...theme.shadows.lg,
  },
  logoText: {
    fontSize: theme.typography.fontSize['4xl'],
    fontWeight: '800',
    color: theme.colors.text.inverse,
  },
  appName: {
    fontSize: theme.typography.fontSize['3xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[2],
  },
  tagline: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  
  // Connection variant styles
  connectionContent: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    width: '100%',
  },
  logoContainer: {
    marginBottom: theme.spacing[8],
  },
  logoBackground: {
    width: 72,
    height: 72,
    borderRadius: theme.borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.lg,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  primaryTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[2],
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.typography.fontSize.base,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: theme.typography.lineHeight.relaxed * theme.typography.fontSize.base,
  },
  
  // Loading section styles
  loadingSection: {
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  modernSpinner: {
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: theme.spacing[4],
  },
  spinnerContainer: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: theme.spacing[4],
  },
  loadingText: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[2],
  },
  loadingSubtext: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  
  // Progress styles
  progressContainer: {
    alignItems: 'center',
    marginTop: theme.spacing[4],
    width: 200,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
    marginBottom: theme.spacing[2],
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.text.inverse,
    borderRadius: theme.borderRadius.sm,
  },
  progressText: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  
  // Features styles
  featuresContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: theme.spacing[4],
  },
  feature: {
    alignItems: 'center',
    flex: 1,
  },
  featureText: {
    fontSize: theme.typography.fontSize.xs,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: theme.spacing[2],
    fontWeight: '500',
  },
  
  // Status dots
  statusDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  
  // Minimal variant
  minimalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background.secondary,
    paddingHorizontal: theme.spacing[5],
  },
  minimalText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    textAlign: 'center',
  },
});

export default LoadingScreen; 