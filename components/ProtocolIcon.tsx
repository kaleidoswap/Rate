/**
 * ProtocolIcon — renders the correct icon + color for each protocol.
 * Used consistently across Dashboard, Deposit, Withdraw, Swap screens.
 */
import React from 'react'
import { View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

export type ProtocolKey = 'RGB' | 'SPARK' | 'ARKADE' | 'BTC' | 'LIGHTNING'

export const PROTOCOL_COLORS: Record<ProtocolKey, string> = {
  BTC: '#F7931A',       // Bitcoin orange
  LIGHTNING: '#FACC15',  // Lightning yellow
  RGB: '#2BEE79',       // KaleidoSwap green (primary)
  SPARK: '#60A5FA',     // Spark blue
  ARKADE: '#A855F7',    // Arkade purple
}

export const PROTOCOL_ICONS: Record<ProtocolKey, keyof typeof Ionicons.glyphMap> = {
  BTC: 'logo-bitcoin',
  LIGHTNING: 'flash',
  RGB: 'diamond',
  SPARK: 'sparkles',
  ARKADE: 'shield-checkmark',
}

export const PROTOCOL_LABELS: Record<ProtocolKey, string> = {
  BTC: 'Bitcoin',
  LIGHTNING: 'Lightning',
  RGB: 'RGB & Lightning',
  SPARK: 'Spark',
  ARKADE: 'Arkade',
}

export const PROTOCOL_SHORT_LABELS: Record<ProtocolKey, string> = {
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
}

export const NETWORK_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'onchain': 'link',
  'on-chain': 'link',
  'lightning': 'flash',
  'spark': 'sparkles',
  'arkade': 'shield-checkmark',
}

export const NETWORK_LABELS: Record<string, string> = {
  'onchain': 'On-chain',
  'on-chain': 'On-chain',
  'lightning': 'Lightning',
  'spark': 'Spark',
  'arkade': 'Arkade',
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
