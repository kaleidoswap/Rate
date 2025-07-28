import React, { useState } from 'react';
import { TextInput, View, Text, StyleSheet, TextInputProps, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  style?: ViewStyle;
  inputStyle?: TextStyle;
  variant?: 'default' | 'outlined' | 'filled';
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  style,
  inputStyle,
  variant = 'default',
  size = 'md',
  leftIcon,
  rightIcon,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const getContainerStyle = () => {
    const baseStyle = styles.container;
    
    switch (variant) {
      case 'outlined':
        return { ...baseStyle, ...styles.outlined };
      case 'filled':
        return { ...baseStyle, ...styles.filled };
      default:
        return { ...baseStyle, ...styles.default };
    }
  };

  const getInputStyle = () => {
    const baseStyle = {
      ...styles.input,
      ...styles[size],
    };
    
    if (isFocused) {
      return { ...baseStyle, ...styles.focused };
    }
    
    if (error) {
      return { ...baseStyle, ...styles.error };
    }
    
    return baseStyle;
  };

  return (
    <View style={[style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      
      <View style={[getContainerStyle(), isFocused && styles.containerFocused, error && styles.containerError]}>
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        
        <TextInput
          style={[getInputStyle(), inputStyle]}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholderTextColor={theme.colors.text.muted}
          {...props}
        />
        
        {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
      </View>
      
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  
  containerFocused: {
    borderColor: theme.colors.primary[500],
    ...theme.shadows.sm,
  },
  
  containerError: {
    borderColor: theme.colors.error[500],
  },
  
  // Variant styles
  default: {
    backgroundColor: theme.colors.background.secondary,
  },
  
  outlined: {
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1.5,
  },
  
  filled: {
    backgroundColor: theme.colors.gray[100],
    borderWidth: 0,
  },
  
  input: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeight.normal,
  },
  
  focused: {
    // Additional focused styles if needed
  },
  
  error: {
    // Additional error styles if needed
  },
  
  // Size variants
  sm: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    fontSize: theme.typography.fontSize.sm,
  },
  
  md: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    fontSize: theme.typography.fontSize.base,
  },
  
  lg: {
    paddingVertical: theme.spacing[5],
    paddingHorizontal: theme.spacing[5],
    fontSize: theme.typography.fontSize.lg,
  },
  
  label: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
  },
  
  errorText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[500],
    marginTop: theme.spacing[1],
  },
  
  leftIcon: {
    marginLeft: theme.spacing[3],
    marginRight: theme.spacing[2],
  },
  
  rightIcon: {
    marginLeft: theme.spacing[2],
    marginRight: theme.spacing[3],
  },
}); 