import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

type CardVariant = 'default' | 'elevated' | 'gradient' | 'outlined';

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  style?: ViewStyle;
  gradientColors?: string[];
  onPress?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  style,
  gradientColors = theme.colors.primary.gradient,
  onPress,
}) => {
  const getCardStyle = () => {
    switch (variant) {
      case 'default':
        return styles.default;
      case 'elevated':
        return styles.elevated;
      case 'gradient':
        return styles.gradient;
      case 'outlined':
        return styles.outlined;
      default:
        return styles.default;
    }
  };

  const cardStyle = { ...getCardStyle(), ...style };

  if (variant === 'gradient') {
    return (
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={cardStyle}
      >
        {children}
      </LinearGradient>
    );
  }

  return (
    <View style={cardStyle}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  default: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[5],
    ...theme.shadows.base,
  },
  
  elevated: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[6],
    ...theme.shadows.lg,
  },
  
  gradient: {
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[5],
    ...theme.shadows.md,
  },
  
  outlined: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[5],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
}); 