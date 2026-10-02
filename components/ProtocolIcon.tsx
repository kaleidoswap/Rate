/**
 * ProtocolIcon — renders the correct icon + color for each protocol.
 * Used consistently across Dashboard, Deposit, Withdraw, Swap screens.
 */
import React from 'react'
import { View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { theme } from '../theme'

export type ProtocolKey = 'RGB' | 'SPARK' | 'ARKADE' | 'BARK' | 'BTC' | 'LIGHTNING'

export const PROTOCOL_COLORS: Record<ProtocolKey, string> = {
  BARK: theme.colors.primary[500],
  BTC: theme.colors.networks.bitcoin,       // Bitcoin orange
  LIGHTNING: theme.colors.networks.lightning,  // Lightning yellow
  RGB: theme.colors.networks.unified,       // KaleidoSwap green (primary)
  SPARK: theme.colors.networks.spark,     // Spark accent
  ARKADE: theme.colors.networks.arkade,    // Arkade purple
}

export const PROTOCOL_ICONS: Record<ProtocolKey, keyof typeof Ionicons.glyphMap> = {
  BARK: 'leaf-outline',
  BTC: 'logo-bitcoin',
  LIGHTNING: 'flash',
  RGB: 'diamond',
  SPARK: 'sparkles',
  ARKADE: 'shield-checkmark',
}

export const PROTOCOL_LABELS: Record<ProtocolKey, string> = {
  BARK: 'Bark',
  BTC: 'Bitcoin',
  LIGHTNING: 'Lightning',
  RGB: 'RGB & Lightning',
  SPARK: 'Spark',
  ARKADE: 'Arkade',
}

export const PROTOCOL_SHORT_LABELS: Record<ProtocolKey, string> = {
  BARK: 'Bark',
  BTC: 'BTC',
  LIGHTNING: 'LN',
  RGB: 'RLN',
  SPARK: 'Spark',
  ARKADE: 'Arkade',
}

// Network-specific colors for deposit/withdraw flows
export const NETWORK_COLORS: Record<string, string> = {
  'onchain': PROTOCOL_COLORS.BTC,
  'on-chain': PROTOCOL_COLORS.BTC,
  'lightning': PROTOCOL_COLORS.LIGHTNING,
  'spark': PROTOCOL_COLORS.SPARK,
  'arkade': PROTOCOL_COLORS.ARKADE,
  'bark': PROTOCOL_COLORS.BARK,
}

export const NETWORK_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'onchain': 'link',
  'on-chain': 'link',
  'lightning': 'flash',
  'spark': 'sparkles',
  'arkade': 'shield-checkmark',
  'bark': 'leaf-outline',
}

export const NETWORK_LABELS: Record<string, string> = {
  'onchain': 'On-chain',
  'on-chain': 'On-chain',
  'lightning': 'Lightning',
  'spark': 'Spark',
  'arkade': 'Arkade',
  'bark': 'Bark',
}

interface ProtocolIconProps {
  protocol: ProtocolKey
  size?: number
  showBackground?: boolean
}

export function ProtocolIcon({ protocol, size = 20, showBackground = false }: ProtocolIconProps) {
  const color = PROTOCOL_COLORS[protocol] || PROTOCOL_COLORS.BTC
  const icon = PROTOCOL_ICONS[protocol] || PROTOCOL_ICONS.BTC

  if (showBackground) {
    return (
      <View style={[styles.iconBg, { width: size + 12, height: size + 12, borderRadius: (size + 12) / 2, backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={size} color={color} />
      </View>
    )
  }

  return <Ionicons name={icon} size={size} color={color} />
}

interface ProtocolBadgeProps {
  protocol: ProtocolKey
  size?: 'sm' | 'md'
}

export function ProtocolBadge({ protocol, size = 'sm' }: ProtocolBadgeProps) {
  const color = PROTOCOL_COLORS[protocol] || PROTOCOL_COLORS.BTC
  const icon = PROTOCOL_ICONS[protocol] || PROTOCOL_ICONS.BTC
  const iconSize = size === 'sm' ? 10 : 14

  return (
    <View style={[styles.badge, { backgroundColor: color + '20', borderColor: color + '40' }]}>
      <Ionicons name={icon} size={iconSize} color={color} />
    </View>
  )
}

const styles = StyleSheet.create({
  iconBg: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
