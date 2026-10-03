import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export function WalletSetupPrompt({ hasExistingWallet, onCreate, onRestore }: {
  hasExistingWallet: boolean;
  onCreate: () => void;
  onRestore: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={{ margin: theme.spacing[4], padding: theme.spacing[6], gap: theme.spacing[4], backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.xl }}>
      <Ionicons name="wallet-outline" size={36} color={theme.colors.primary[500]} />
      <Text accessibilityRole="header" style={{ fontSize: theme.typography.fontSize.xl, fontWeight: '600', color: theme.colors.text.primary }}>
        {hasExistingWallet ? 'Restore your wallet' : 'Set up your wallet'}
      </Text>
      <Text style={{ fontSize: theme.typography.fontSize.base, color: theme.colors.text.secondary }}>
        {hasExistingWallet
          ? 'This device can’t access your wallet keys. Restore with your recovery phrase to see your balance and make payments.'
          : 'Create a wallet to receive, send, and swap. Already have one? Restore it with your recovery phrase.'}
      </Text>
      <Button title={hasExistingWallet ? 'Restore wallet' : 'Create wallet'} onPress={hasExistingWallet ? onRestore : onCreate} fullWidth />
      <Button title={hasExistingWallet ? 'Create a new wallet' : 'Restore wallet'} onPress={hasExistingWallet ? onCreate : onRestore} variant="secondary" fullWidth />
    </View>
  );
}
