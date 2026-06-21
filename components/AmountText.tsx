// components/AmountText.tsx
//
// Text for numeric values (balances, amounts, fees). Forces tabular figures so
// digits share a fixed advance width — the headline balance no longer jitters
// as it animates/refreshes, and stacked amounts line up on the decimal. Use it
// anywhere a number is the content; pass `style` for size/weight/color as usual.
import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';

export const AmountText: React.FC<TextProps> = ({ style, ...props }) => (
  <Text {...props} style={[styles.tabular, style]} />
);

const styles = StyleSheet.create({
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});

export default AmountText;
