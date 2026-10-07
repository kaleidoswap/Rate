// components/receive/BridgeEntryCard.tsx
//
// Receive › "Deposit from another chain": opens the bridge that brings
// stablecoins and other assets from Ethereum, Tron, Solana… into Spark.
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { feedback } from '../../utils/feedback';
import { isOrchestraConfigured } from '../../services/orchestra/client';
import { ChainStack } from '../bridge/BridgeIcons';

const CHAINS = ['ethereum', 'tron', 'solana', 'base'];

export function BridgeEntryCard({ onPress }: { onPress: () => void }) {
  const t = useAppTheme();
  if (!isOrchestraConfigured()) return null;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Deposit from another chain. USDT, USDC, ETH or SOL from Ethereum, Tron, Solana and more"
      onPress={() => { feedback.select(); onPress(); }}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[4], marginTop: t.spacing[4],
        borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light,
      }}
    >
      <ChainStack chains={CHAINS} size={24} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>Deposit from another chain</Text>
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs }} numberOfLines={2}>
          USDT, USDC, ETH or SOL, delivered to Spark
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.colors.text.tertiary} />
    </TouchableOpacity>
  );
}
