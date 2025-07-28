// components/Card.tsx
import React from 'react';
import { View, ViewStyle, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

type CardVariant = 'default' | 'elevated' | 'gradient' | 'outlined';

// Proper gradient colors type for LinearGradient
type GradientColors = [string, string, ...string[]];

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  style?: ViewStyle | ViewStyle[];
  gradientColors?: string[];
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

// Safe theme access with fallbacks
const safeTheme = {
  colors: {
    surface: {
      primary: theme?.colors?.surface?.primary || '#ffffff',
    },
    border: {
      light: theme?.colors?.border?.light || '#e5e7eb',
    },
  },
  borderRadius: {
    lg: theme?.borderRadius?.lg || 12,
    xl: theme?.borderRadius?.xl || 16,
  },
  spacing: theme?.spacing || [0, 4, 8, 12, 16, 20, 24, 28, 32],
};

/**
 * Safe gradient colors validator for LinearGradient
 */
const safeGradientColors = (
  colors?: string[],
  fallback: GradientColors = ['#667eea', '#764ba2']
): GradientColors => {
  if (!colors || !Array.isArray(colors) || colors.length < 2) {
    return fallback;
  }

  // Validate that all colors are strings and not empty
  const validColors = colors.filter(
    (color): color is string => 
      typeof color === 'string' && 
      color.length > 0 && 
      (color.startsWith('#') || color.startsWith('rgb') || color.startsWith('hsl'))
  );

  if (validColors.length < 2) {
    return fallback;
  }

  // Return properly typed array
  return [validColors[0], validColors[1], ...validColors.slice(2)] as GradientColors;
};

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  style,
  gradientColors,
  onPress,
  disabled = false,
  testID,
}) => {
  // Early validation of children
  if (children === undefined || children === null) {
    console.warn('Card component received undefined or null children');
    return <View style={styles.emptyCard} testID={testID} />;
  }

  // Handle invalid children types
  if (typeof children === 'string' && children.trim() === '') {
    console.warn('Card component received empty string as children');
    return <View style={styles.emptyCard} testID={testID} />;
  }

  // Validate and provide fallback for gradientColors
  const getGradientColors = (): GradientColors => {
    return safeGradientColors(gradientColors, ['#667eea', '#764ba2']);
  };

  const getCardStyle = (): ViewStyle => {
    let baseStyle: ViewStyle;
    
    try {
      switch (variant) {
        case 'elevated':
          baseStyle = styles.elevated;
          break;
        case 'gradient':
          baseStyle = styles.gradient;
          break;
        case 'outlined':
          baseStyle = styles.outlined;
          break;
        default:
          baseStyle = styles.default;
      }
    } catch (error) {
      console.warn('Error getting card style, using default:', error);
      baseStyle = styles.default;
    }
    
    // Handle style prop being an array or single object
    let combinedStyle: ViewStyle = {};
    try {
      if (style) {
        if (Array.isArray(style)) {
          combinedStyle = style.reduce((acc, s) => ({ ...acc, ...(s || {}) }), {});
        } else {
          combinedStyle = style || {};
        }
      }
    } catch (error) {
      console.warn('Error processing card style:', error);
      combinedStyle = {};
    }
    
    return {
      ...baseStyle,
      ...combinedStyle,
      ...(disabled && styles.disabled),
    };
  };

  const cardStyle = getCardStyle();

  // Wrap content in error boundary
  const SafeContent = () => {
    try {
      return <>{children}</>;
    } catch (error) {
      console.error('Error rendering card content:', error);
      return <View style={styles.errorContent} />;
    }
  };

  // If onPress is provided, wrap in TouchableOpacity
  if (onPress && !disabled) {
    if (variant === 'gradient') {
      return (
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.8}
          testID={testID}
        >
          <LinearGradient
            colors={getGradientColors()}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={cardStyle}
          >
            <SafeContent />
          </LinearGradient>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={onPress}
        activeOpacity={0.8}
        testID={testID}
      >
        <SafeContent />
      </TouchableOpacity>
    );
  }

  // Static card without onPress
  if (variant === 'gradient') {
    return (
      <LinearGradient
        colors={getGradientColors()}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={cardStyle}
        testID={testID}
      >
        <SafeContent />
      </LinearGradient>
    );
  }

  return (
    <View style={cardStyle} testID={testID}>
      <SafeContent />
    </View>
  );
};

const styles = StyleSheet.create({
  default: {
    backgroundColor: safeTheme.colors.surface.primary,
    borderRadius: safeTheme.borderRadius.lg,
    padding: safeTheme.spacing[5],
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  elevated: {
    backgroundColor: safeTheme.colors.surface.primary,
    borderRadius: safeTheme.borderRadius.xl,
    padding: safeTheme.spacing[6],
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  gradient: {
    borderRadius: safeTheme.borderRadius.lg,
    padding: safeTheme.spacing[5],
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.12,
    shadowRadius: 4.65,
    elevation: 7,
  },
  
  outlined: {
    backgroundColor: safeTheme.colors.surface.primary,
    borderRadius: safeTheme.borderRadius.lg,
    padding: safeTheme.spacing[5],
    borderWidth: 1,
    borderColor: safeTheme.colors.border.light,
  },
  
  disabled: {
    opacity: 0.6,
  },
  
  emptyCard: {
    backgroundColor: safeTheme.colors.surface.primary,
    borderRadius: safeTheme.borderRadius.lg,
    padding: safeTheme.spacing[5],
    minHeight: 50,
  },
  
  errorContent: {
    backgroundColor: '#fee2e2',
    borderRadius: 4,
    padding: 8,
    minHeight: 20,
  },
});

export default Card;