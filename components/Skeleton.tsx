// components/Skeleton.tsx
//
// Shimmering placeholder blocks shown while content loads — smoother and more
// premium than a spinner. A highlight sweeps across the block on the UI thread
// (reanimated), which reads as faster/more "alive" than a plain opacity pulse,
// over a gentle base pulse so it never looks frozen while data is in flight.

import React, { useEffect, useState } from 'react';
import { DimensionValue, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { useAppTheme } from '../theme/ThemeProvider';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = 16, radius = 8, style }) => {
  const theme = useAppTheme();
  const pulse = useSharedValue(0);
  const sweep = useSharedValue(0);
  // Measured pixel width so the highlight can travel the block's real extent
  // even when `width` is a percentage.
  const [w, setW] = useState(0);

  useEffect(() => {
    // Quicker, higher-contrast base pulse than before (was 1050ms / 0.4–0.85).
    pulse.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
    sweep.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.linear }), -1, false);
  }, []);

  const baseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.45, 0.9]),
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-w, w]) }],
    opacity: w > 0 ? 1 : 0,
  }));

  return (
    <Animated.View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.colors.surface.secondary, overflow: 'hidden' },
        baseStyle,
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.22)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  );
};

export default Skeleton;
