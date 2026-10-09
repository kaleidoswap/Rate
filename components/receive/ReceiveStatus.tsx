import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { DepositDetectionStatus } from '../../hooks/useDepositDetection';

export type ReceiveStatusValue = 'idle' | 'generating' | DepositDetectionStatus;
export function ReceiveStatus({ visible, status, message, hint }: {
  visible: boolean; status: ReceiveStatusValue; message?: string;
  /** What the user must do while waiting, e.g. keep the app open. */
  hint?: string;
}) {
  const t = useAppTheme();
  if (!visible) return null;
  const problem = status === 'failed' || status === 'expired';
  const received = status === 'confirmed' || status === 'claimed';
  const busy = status === 'pending' || status === 'generating';
  const title = received ? 'Payment received' : status === 'pending' ? 'Payment detected · confirming'
    : status === 'generating' ? 'Preparing your request' : status === 'expired' ? 'Request expired'
    : status === 'failed' ? 'Could not confirm payment' : 'Waiting for payment';
  const color = problem ? t.colors.warning[500] : received ? t.colors.success[500] : t.colors.text.secondary;
  return <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[3] }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
      {busy ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={received ? 'checkmark-circle' : problem ? 'alert-circle-outline' : 'time-outline'} size={18} color={color} />}
      <Text style={{ color, fontSize: t.typography.fontSize.sm }}>{title}</Text>
    </View>
    {!!hint && !received && !problem && <Text style={{ color: t.colors.warning[500], textAlign: 'center', fontSize: t.typography.fontSize.xs }}>{hint}</Text>}
    {!!message && (problem || busy || status === 'watching') && <Text style={{ color: t.colors.text.secondary, textAlign: 'center', fontSize: t.typography.fontSize.sm }}>{message}</Text>}
  </View>;
}
