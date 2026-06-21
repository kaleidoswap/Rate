// components/Divider.tsx
//
// A themed hairline separator. Use instead of inline
// `borderBottomWidth: StyleSheet.hairlineWidth` blocks so the colour and weight
// stay consistent across rows and sections.
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { theme } from '../theme';

interface DividerProps {
  /** Left/right inset in px (default 0). */
  inset?: number;
  /** Vertical spacing above/below in px (default 0). */
  spacing?: number;
  style?: ViewStyle;
}

export const Divider: React.FC<DividerProps> = ({ inset = 0, spacing = 0, style }) => (
  <View
    style={[
      styles.line,
      { marginHorizontal: inset, marginVertical: spacing },
      style,
    ]}
  />
);

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border.light,
  },
});

export default Divider;
