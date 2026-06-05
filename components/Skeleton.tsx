// components/Skeleton.tsx
//
// Shimmering placeholder blocks shown while content loads — smoother and more
// premium than a spinner. Pulses opacity on the UI thread via reanimated.

import React, { useEffect } from 'react';
import { DimensionValue, StyleProp, ViewStyle } from 'react-native';
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
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1050, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.4, 0.85]),
  }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.colors.surface.secondary },
        animatedStyle,
        style,
      ]}
    />
  );
};

export default Skeleton;
