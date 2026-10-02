import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppSelector } from '../../store/hooks';
import { useAppTheme } from '../../theme/ThemeProvider';
import { loadPaymentAttempt, unresolvedAttempt, type PaymentAttempt } from '../../services/kaleidoPay/attempts';

/** Recovery is wallet scoped and never retries a payment. */
export function UnresolvedPaymentCard({ onCheck }: { onCheck: () => void }) {
  const t = useAppTheme();
  const walletId = useAppSelector(state => state.wallet.activeWallet?.id);
  const [saved, setSaved] = useState<{ walletId: number; attempt: PaymentAttempt | null; unreadable?: boolean } | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (walletId != null) void loadPaymentAttempt(walletId)
      .then(attempt => { if (active) setSaved({ walletId, attempt }); })
      .catch(() => { if (active) setSaved({ walletId, attempt: null, unreadable: true }); });
    return () => { active = false; };
  }, [walletId]));
  if (!saved || saved.walletId !== walletId || (!saved.unreadable && !unresolvedAttempt(saved.attempt))) return null;
  return <View style={{ padding: t.spacing[4], gap: t.spacing[2], backgroundColor: t.colors.surface.secondary, borderRadius: t.borderRadius.lg, margin: t.spacing[4] }}>
    <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>{saved.attempt?.status === 'pending' ? 'Payment in progress' : 'Payment needs checking'}</Text>
    <Text style={{ color: t.colors.text.secondary }}>{saved.unreadable ? 'Could not read the last payment record. Check it before paying again.' : `${saved.attempt?.total} · ${saved.attempt?.provider}`}</Text>
    <TouchableOpacity accessibilityRole="button" onPress={onCheck} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: t.colors.primary[500], fontWeight: '600' }}>Check payment</Text>
    </TouchableOpacity>
  </View>;
}
