// components/KeyboardSafeView.tsx
import React, { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

interface KeyboardSafeViewProps {
  children: ReactNode;
  offset?: number;
}

export function KeyboardSafeView({ children, offset = 0 }: KeyboardSafeViewProps) {
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 + offset : 0}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
