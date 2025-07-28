import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'error';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
  loading?: boolean;
  gradient?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  style,
  textStyle,
  disabled = false,
  loading = false,
  gradient = false,
  icon,
  fullWidth = false,
}) => {
  const getButtonStyle = () => {
    const baseStyle = {
      ...styles.base,
      ...styles[size],
      ...(fullWidth && { width: '100%' }),
    };

    switch (variant) {
      case 'primary':
        return { ...baseStyle, ...styles.primary };
      case 'secondary':
        return { ...baseStyle, ...styles.secondary };
      case 'ghost':
        return { ...baseStyle, ...styles.ghost };
      case 'success':
        return { ...baseStyle, ...styles.success };
      case 'warning':
        return { ...baseStyle, ...styles.warning };
      case 'error':
        return { ...baseStyle, ...styles.error };
      default:
        return { ...baseStyle, ...styles.primary };
    }
  };

  const getTextStyle = () => {
    const baseTextStyle = styles.text;
    
    switch (variant) {
      case 'primary':
        return { ...baseTextStyle, color: theme.colors.text.inverse };
      case 'secondary':
        return { ...baseTextStyle, color: theme.colors.text.primary };
      case 'ghost':
        return { ...baseTextStyle, color: theme.colors.primary[500] };
      case 'success':
        return { ...baseTextStyle, color: theme.colors.text.inverse };
      case 'warning':
        return { ...baseTextStyle, color: theme.colors.text.inverse };
      case 'error':
        return { ...baseTextStyle, color: theme.colors.text.inverse };
      default:
        return { ...baseTextStyle, color: theme.colors.text.inverse };
    }
  };

  const getGradientColors = () => {
    switch (variant) {
      case 'primary':
        return theme.colors.primary.gradient;
      case 'success':
        return theme.colors.success.gradient;
      case 'warning':
        return theme.colors.warning.gradient;
      case 'error':
        return theme.colors.error.gradient;
      default:
        return theme.colors.primary.gradient;
    }
  };

  const buttonStyle = getButtonStyle();
  const finalTextStyle = { ...getTextStyle(), ...textStyle };

  const buttonContent = (
    <>
      {loading && (
        <ActivityIndicator 
          size="small" 
          color={variant === 'secondary' || variant === 'ghost' ? theme.colors.primary[500] : theme.colors.text.inverse}
          style={styles.loadingIcon}
        />
      )}
      {icon && !loading && <>{icon}</>}
      <Text style={finalTextStyle}>{title}</Text>
    </>
  );

  if (gradient && (variant === 'primary' || variant === 'success' || variant === 'warning' || variant === 'error')) {
    return (
      <TouchableOpacity
        style={[buttonStyle, disabled && styles.disabled, style]}
        onPress={onPress}
        disabled={disabled || loading}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={getGradientColors()}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.gradientInner, buttonStyle]}
        >
          {buttonContent}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[buttonStyle, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {buttonContent}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.md,
    ...theme.shadows.sm,
  },
  
  // Size variants
  sm: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    minHeight: 36,
  },
  md: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
    minHeight: 48,
  },
  lg: {
    paddingVertical: theme.spacing[5],
    paddingHorizontal: theme.spacing[8],
    minHeight: 56,
  },
  
  // Style variants
  primary: {
    backgroundColor: theme.colors.primary[500],
  },
  secondary: {
    backgroundColor: theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  success: {
    backgroundColor: theme.colors.success[500],
  },
  warning: {
    backgroundColor: theme.colors.warning[500],
  },
  error: {
    backgroundColor: theme.colors.error[500],
  },
  
  disabled: {
    opacity: 0.5,
  },
  
  text: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    textAlign: 'center',
  },
  
  loadingIcon: {
    marginRight: theme.spacing[2],
  },
  
  gradientInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.md,
  },
}); 