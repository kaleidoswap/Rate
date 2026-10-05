// components/receive/MyAddressPanel.tsx
//
// Receive › My address: the reusable ways to get paid. Your kaleidoswap.me
// Lightning address as a big QR (any amount, any time, no expiry) and, with a
// receiving node, the reusable BOLT12 code for a shop.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { NetworkIcon } from '../NetworkIcon';
import { ReceiveQr } from './ReceiveQr';
import { ReceiveRequestActions } from './ReceiveRequestActions';
import { getStoredHandle } from '../../services/kaleidoswapMe';

export function MyAddressPanel({ walletId, qrSize, showLightningAddress, showOffer, onManageAddress, onOpenOffer }: {
  walletId?: number;
  qrSize: number;
  /** The Lightning address needs a Spark account on mainnet. */
  showLightningAddress: boolean;
  /** The reusable BOLT12 code needs a receiving node. */
  showOffer: boolean;
  onManageAddress: () => void;
  onOpenOffer: () => void;
}) {
  const t = useAppTheme();
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  useFocusEffect(useCallback(() => {
    if (walletId == null || !showLightningAddress) { setAddress(null); return; }
    let live = true;
    void getStoredHandle(walletId).then(h => { if (live) setAddress(h?.lightningAddress ?? null); }).catch(() => { if (live) setAddress(null); });
    return () => { live = false; };
  }, [walletId, showLightningAddress]));

  const card = { borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light };
  const muted = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm, textAlign: 'center' as const };

  return <View style={{ gap: t.spacing[3] }}>
    {showLightningAddress && (address === undefined
      ? <View style={{ paddingVertical: t.spacing[10], alignItems: 'center' }}><ActivityIndicator color={t.colors.primary[500]} /></View>
      : address
        ? <>
          <View style={[card, { padding: t.spacing[4], alignItems: 'center', gap: t.spacing[3] }]}>
            <ReceiveQr value={`lightning:${address}`} size={qrSize} />
            <Text selectable style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.lg, fontWeight: '700' }}>{address}</Text>
            <Text style={muted}>Reusable. Anyone can pay you any amount, any time, even while the app is closed.</Text>
          </View>
          <ReceiveRequestActions value={address} label="Lightning address" />
          <TouchableOpacity accessibilityRole="button" onPress={onManageAddress} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: t.colors.primary[500], fontWeight: '600' }}>Manage address</Text>
          </TouchableOpacity>
        </>
        : <TouchableOpacity accessibilityRole="button" accessibilityLabel="Get a Lightning address" onPress={onManageAddress} activeOpacity={0.7}
          style={[card, { padding: t.spacing[5], alignItems: 'center', gap: t.spacing[2] }]}>
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.networks.lightning + '26' }}>
            <NetworkIcon network="lightning" size={28} />
          </View>
          <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.lg, fontWeight: '700' }}>Get name@kaleidoswap.me</Text>
          <Text style={muted}>One address that never expires. Share it once, get paid any amount, any time.</Text>
        </TouchableOpacity>)}

    {showOffer && (
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Create a reusable payment QR" onPress={onOpenOffer} activeOpacity={0.7}
        style={[card, { flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[4] }]}>
        <Ionicons name="storefront-outline" size={20} color={t.colors.primary[500]} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>Reusable QR for a shop</Text>
          <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs }}>One BOLT12 code for many payments</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.colors.text.tertiary} />
      </TouchableOpacity>
    )}
  </View>;
}
