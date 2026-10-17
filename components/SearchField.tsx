// components/SearchField.tsx
//
// The app's search bar: a 44pt rounded surface with a search icon, the input
// and a clear button (44pt target) once there is text. Highlights its border
// while focused.
import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ViewStyle, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../theme';

interface SearchFieldProps extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: ViewStyle;
}

export function SearchField({ value, onChangeText, placeholder = 'Search', style, accessibilityLabel, ...rest }: SearchFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.bar, focused && styles.barFocused, style]}>
      <Ionicons name="search" size={18} color={focused ? theme.colors.text.secondary : theme.colors.text.tertiary} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        {...rest}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.tertiary}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search"
          style={styles.clear} activeOpacity={0.7}>
          <Ionicons name="close-circle" size={18} color={theme.colors.text.tertiary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    height: 44,
    paddingLeft: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  barFocused: {
    borderColor: theme.colors.primary[500],
  },
  input: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    paddingRight: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    lineHeight: leading(theme.typography.fontSize.base, theme.typography.lineHeight.tight),
    color: theme.colors.text.primary,
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -theme.spacing[3],
  },
});
