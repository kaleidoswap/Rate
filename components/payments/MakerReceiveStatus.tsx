import React from 'react';
import { View, Text } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { ArkadeLightningReceive } from '../../services/kaleidoPay/arkadeIntents';

export function MakerReceiveStatus({ receipt, phase, connected, now, children }: {
  receipt: ArkadeLightningReceive; phase: string; connected: boolean; now: number; children?: React.ReactNode;
}) {
  const t = useAppTheme();
  const settled = phase === 'settled';
  const closed = ['failed', 'refunded', 'cancelled'].includes(phase);
  const expired = receipt.expiresAt * 1000 <= now;
  const title = settled ? 'Received in Arkade' : closed ? 'Request closed' : !connected ? 'Saved request · reconnect to check status' : phase === 'funded' ? 'Payment received · claiming' : phase === 'checking' ? 'Connection interrupted · checking saved request' : 'Waiting for payment or confirmation';
  const small = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  return <View style={{ backgroundColor: t.colors.surface.primary, borderRadius: t.borderRadius.xl, borderWidth: 1, borderColor: t.colors.border.light, padding: t.spacing[5], gap: t.spacing[4] }}>
    <View style={{ gap: t.spacing[3], alignItems: 'center' }}>
      <View style={{ width: 56, height: 56, borderRadius: t.borderRadius.full, backgroundColor: t.colors.surface.highlight, alignItems: 'center', justifyContent: 'center' }}>
        <Text accessible={false} style={{ color: settled ? t.colors.primary[500] : t.colors.text.secondary, fontSize: t.typography.fontSize['2xl'] }}>{settled ? '✓' : closed ? '−' : '↙'}</Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ ...small, textAlign: 'center' }}>{title}</Text>
      <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize['3xl'], fontWeight: '700', textAlign: 'center' }}>{receipt.amountSats.toLocaleString()} sats</Text>
      <Text style={small}>{settled ? 'In your Arkade wallet' : 'To your Arkade wallet'}</Text>
    </View>
    <View style={{ borderTopWidth: 1, borderColor: t.colors.border.light, paddingTop: t.spacing[4], gap: t.spacing[2] }}>
      <Text style={small}>You receive {receipt.amountSats.toLocaleString()} sats · sender pays {receipt.payAmountSats.toLocaleString()} sats</Text>
      <Text style={small}>Provider: {receipt.provider}. Requests are restored after reopening.</Text>
      {!settled && !closed && !expired && <Text style={small}>Payment window: {Math.max(0, Math.ceil((receipt.expiresAt * 1000 - now) / 1000))}s remaining</Text>}
      {expired && !settled && !closed && <Text style={small}>Payment window closed. Checking the existing swap; do not pay this invoice again.</Text>}
    </View>
    {children}
  </View>;
}
