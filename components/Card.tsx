import React from 'react';
import { View, ViewStyle, StyleProp, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../theme/ThemeProvider';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'gradient' | 'outlined';
  style?: StyleProp<ViewStyle>;
  gradientColors?: string[];
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

export function Card({
  children,
  variant = 'default',
  style,
  gradientColors,
  onPress,
  disabled = false,
  testID,
}: CardProps) {
  const t = useAppTheme();
  const cardStyle: StyleProp<ViewStyle> = [
    variant === 'elevated'
      ? t.components.card.elevated
      : t.components.card.default,
    variant === 'outlined' && {
      borderWidth: 1,
      borderColor: t.colors.border.medium,
    },
    disabled && { opacity: 0.6 },
    style,
  ];
  const validColors = gradientColors?.filter(
    (c) => typeof c === 'string' && /^(#|rgb|hsl)/.test(c)
  );
  const colors: [string, string, ...string[]] =
    validColors && validColors.length >= 2
      ? [validColors[0], validColors[1], ...validColors.slice(2)]
      : [t.colors.surface.primary, t.colors.surface.elevated];
  if (variant === 'gradient') {
    const content = (
      <LinearGradient
        colors={colors}
        style={cardStyle}
        testID={onPress ? undefined : testID}
      >
        {children}
      </LinearGradient>
    );
    return onPress ? (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
      >
        {content}
      </Pressable>
    ) : (
      content
    );
  }
  return onPress ? (
    <Pressable
      testID={testID}
      style={cardStyle}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      {children}
    </Pressable>
  ) : (
    <View testID={testID} style={cardStyle}>
      {children}
    </View>
  );
}
export default Card;
