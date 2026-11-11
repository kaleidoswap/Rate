import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';

/**
 * A quiet placeholder block for content that is still loading: the same shape
 * the content will take, in the card's own muted surface, so the layout
 * settles once instead of jumping when the data lands.
 */
export function Skeleton({ width = '100%', height = 16, radius, label = 'Loading', style }: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  /** What screen readers should call it. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useAppTheme();
  return <View accessible accessibilityLabel={label} style={[{ width, height, borderRadius: radius ?? t.borderRadius.sm, backgroundColor: t.colors.surface.tertiary }, style]} />;
}
