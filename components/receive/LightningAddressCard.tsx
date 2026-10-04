// components/receive/LightningAddressCard.tsx
//
// Your kaleidoswap.me Lightning address on Receive: the address with a copy
// button, or an invitation to get one. Managing it lives on its own screen.
import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { NetworkIcon } from '../NetworkIcon';
import { CopyButton } from '../CopyButton';
import { getStoredHandle } from '../../services/kaleidoswapMe';

export function LightningAddressCard({ walletId, onOpen }: { walletId?: number; onOpen: () => void }) {
  const t = useAppTheme();
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  useFocusEffect(useCallback(() => {
    if (walletId == null) { setAddress(null); return; }
    let live = true;
    void getStoredHandle(walletId).then(h => { if (live) setAddress(h?.lightningAddress ?? null); });
    return () => { live = false; };
  }, [walletId]));
  if (address === undefined) return null;

  return (
    <TouchableOpacity accessibilityRole="button" onPress={onOpen} activeOpacity={0.7}
      accessibilityLabel={address ? `Lightning address ${address}. Manage` : 'Get a Lightning address'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[4], marginTop: t.spacing[3],
        borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.networks.lightning + '26' }}>
        <NetworkIcon network="lightning" size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs }}>{address ? 'Your Lightning address' : 'Lightning address'}</Text>
        <Text numberOfLines={1} style={{ color: t.colors.text.primary, fontWeight: '600', fontSize: t.typography.fontSize.base }}>
          {address ?? 'Get name@kaleidoswap.me'}
        </Text>
      </View>
      {address ? <CopyButton value={address} /> : <Ionicons name="chevron-forward" size={20} color={t.colors.text.secondary} />}
    </TouchableOpacity>
  );
}
