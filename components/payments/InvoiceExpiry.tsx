import React, { useMemo } from 'react';
import { useForegroundClock } from '../../hooks/useForegroundClock';
import { Text, TouchableOpacity, View } from 'react-native';
import { decode } from 'light-bolt11-decoder';
import { useAppTheme } from '../../theme/ThemeProvider';

export function invoiceExpiry(invoice: string): number | null {
  if (!/^ln(bc|tb|bcrt)/i.test(invoice)) return null;
  try {
    const decoded = decode(invoice);
    const timestamp = Number(decoded.sections.find(s => s.name === 'timestamp')?.value);
    const expiryField = decoded.sections.find(s => s.name === 'expiry');
    const duration = expiryField ? Number(expiryField.value) : 3600; // BOLT11 default
    return Number.isSafeInteger(timestamp) && timestamp > 0 && Number.isSafeInteger(duration) && duration >= 0
      ? (timestamp + duration) * 1000 : null;
  } catch { return null; }
}
export function InvoiceExpiry({ invoice, onRefresh }: { invoice: string; onRefresh?: () => void }) {
  const t = useAppTheme();
  const expiresAt = useMemo(() => invoiceExpiry(invoice), [invoice]);
  const now = useForegroundClock(expiresAt !== null);
  if (expiresAt === null) return null;
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return <View style={{ alignItems: 'center', padding: t.spacing[3], gap: t.spacing[2] }}>
    <Text style={{ color: seconds ? t.colors.text.secondary : t.colors.warning[500] }}>{seconds ? `Lightning invoice expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Lightning invoice expired'}</Text>
    {!seconds && onRefresh && <TouchableOpacity accessibilityRole="button" onPress={onRefresh} style={{ padding: t.spacing[3] }}><Text style={{ color: t.colors.primary[500] }}>Create a fresh request</Text></TouchableOpacity>}
  </View>;
}
