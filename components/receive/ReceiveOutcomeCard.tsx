import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
export function ReceiveOutcomeCard({ status, onRefresh, onActivity, hint, requestedAmount }: {
  status: string; onRefresh?: () => void; onActivity?: () => void; hint?: string; requestedAmount?: string;
}) {
  const t = useAppTheme();
  const received = status === 'confirmed' || status === 'claimed';
  const pending = status === 'pending';
  const expired = status === 'expired';
  const color = received ? t.colors.success[500] : t.colors.warning[500];
  return <View style={{ alignSelf: 'stretch', padding: t.spacing[5], gap: t.spacing[4], borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light }}>
    <Ionicons name={received ? 'checkmark-circle' : pending ? 'time-outline' : 'alert-circle-outline'} size={40} color={color} />
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '600' }}>{received ? 'Payment received' : pending ? 'Payment detected' : expired ? 'Refresh your request' : 'Payment needs checking'}</Text>
    {!received && <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.base }}>{pending ? 'Confirming. The sender does not need to pay again.' : expired ? 'Invoice expired. Create a new request.' : 'Check Activity before asking the sender to pay again.'}</Text>}
    {!!requestedAmount && <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.base }}>Requested · {requestedAmount}</Text>}
    {pending && !!hint && <Text style={{ color: t.colors.warning[500] }}>{hint}</Text>}
    {expired && onRefresh && <Button title="Create a fresh request" onPress={onRefresh} />}
    {!!onActivity && <Button title="View in Activity" variant="secondary" onPress={onActivity} />}
    {received && onRefresh && <Button title="New request" variant="secondary" onPress={onRefresh} />}
  </View>;
}
