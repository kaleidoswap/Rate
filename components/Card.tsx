// components/Card.tsx
import React from 'react';
import { View, ViewStyle, StyleSheet, TouchableOpacity, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

type CardVariant = 'default' | 'elevated' | 'gradient' | 'outlined';

// LinearGradient needs at least two colors.
type GradientColors = [string, string, ...string[]];

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  gradientColors?: string[];
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

/** The brand gradient, used when a gradient card is given fewer than two colors. */
const BRAND_GRADIENT: GradientColors = [theme.colors.primary[500], theme.colors.brand.violet];

function gradientOf(colors?: string[]): GradientColors {
  const valid = (colors ?? []).filter((c) => typeof c === 'string' && c.length > 0);
  return valid.length >= 2 ? (valid as GradientColors) : BRAND_GRADIENT;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  style,
  gradientColors,
  onPress,
  disabled = false,
  testID,
}) => {
  const cardStyle = [styles[variant], style, disabled && styles.disabled];

  const body = variant === 'gradient' ? (
    <LinearGradient
      colors={gradientOf(gradientColors)}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={cardStyle}
      testID={onPress ? undefined : testID}
    >
      {children}
    </LinearGradient>
  ) : null;

  if (onPress && !disabled) {
    return variant === 'gradient' ? (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} testID={testID}>{body}</TouchableOpacity>
    ) : (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.8} testID={testID}>{children}</TouchableOpacity>
    );
  }
  return body ?? <View style={cardStyle} testID={testID}>{children}</View>;
};

const shadow = (height: number, opacity: number, radius: number, elevation: number): ViewStyle => ({
  shadowColor: '#000',
  shadowOffset: { width: 0, height },
  shadowOpacity: opacity,
  shadowRadius: radius,
  elevation,
});

const styles = StyleSheet.create({
  default: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[5],
    ...shadow(2, 0.1, 3.84, 5),
  },
  elevated: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[6],
    ...shadow(4, 0.15, 6.27, 10),
  },
  gradient: {
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[5],
    ...shadow(3, 0.12, 4.65, 7),
  },
  outlined: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[5],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  disabled: {
    opacity: 0.6,
  },
});

export default Card;
