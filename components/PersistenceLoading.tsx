import React, { useSyncExternalStore } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { BrandLoading } from './brand/BrandLoading';
import { getPersistenceRecoveryState, subscribePersistenceRecovery, retryPersistence } from '../store/persistenceRecovery';

export function PersistenceLoading() {
  const needsRetry = useSyncExternalStore(subscribePersistenceRecovery, getPersistenceRecoveryState);
  if (!needsRetry) return <BrandLoading />;
  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.colors.background.primary, padding: theme.spacing[6] }}>
      <View style={{ gap: theme.spacing[4] }}>
        <Text accessibilityRole="header" style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize.xl }}>Secure storage unavailable</Text>
        <Text style={{ color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.base }}>Your saved data has been kept. Unlock your device, then try again to finish the security update.</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry security update" onPress={retryPersistence} style={{ padding: theme.spacing[4], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.primary[500] }}>
          <Text style={{ color: theme.colors.text.inverse, textAlign: 'center', fontSize: theme.typography.fontSize.base }}>Try again</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
