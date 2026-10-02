import React, { useCallback } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useBark } from '../hooks/useBark'
import { barkNetworkLabel } from '../services/BarkService'
import { useAppTheme } from '../theme/ThemeProvider'
import { NetworkIcon } from './NetworkIcon'

export function BarkAccountCard({ onOpen, ready, refreshing }: { onOpen: () => void; ready: boolean; refreshing: boolean }) {
  const theme = useAppTheme()
  const bark = useBark()
  useFocusEffect(useCallback(() => { if (ready && !refreshing && bark.enabled) void bark.refresh() }, [ready, refreshing, bark.enabled, bark.refresh]))
  if (!bark.enabled) return null
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open Bark account" onPress={onOpen}
    style={{ padding: theme.spacing[6], marginVertical: theme.spacing[4], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.background.secondary }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] }}>
      <NetworkIcon network="bark" size={24} />
      <Text style={{ color: theme.colors.text.primary, fontWeight: '600', flex: 1 }}>Bark · {barkNetworkLabel()}</Text>
      <Text style={{ color: theme.colors.primary[500] }}>Open →</Text>
    </View>
    <Text style={{ color: theme.colors.text.primary, marginTop: theme.spacing[2] }}>
      {bark.loading ? 'Loading…' : bark.balance ? `${bark.balance.spendableSats.toLocaleString()} sats available` : 'Not connected'}
    </Text>
    <Text style={{ color: theme.colors.text.secondary, marginTop: theme.spacing[1] }}>
      {bark.error || 'Separate account · excluded from the total above'}
    </Text>
  </TouchableOpacity>
}
