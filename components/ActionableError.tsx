import React, { useEffect, useState } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';

/** Preserve the original error without letting provider diagnostics dominate the flow.
 * This component never infers whether funds moved from an error string.
 */
export function ActionableError({ message, context }: { message: string; context: 'send' | 'receive' }) {
  const t = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [message, context]);
  const secondary = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  return <View accessibilityRole="alert" style={{ padding: t.spacing[4], gap: t.spacing[2], backgroundColor: t.colors.surface.secondary, borderRadius: t.borderRadius.lg, marginBottom: t.spacing[3] }}>
    <Text style={{ color: t.colors.warning[500], fontSize: t.typography.fontSize.base, fontWeight: '600' }}>
      {context === 'send' ? 'Payment needs attention' : 'Could not prepare your request'}
    </Text>
    <Text style={secondary}>{context === 'send'
      ? 'Check the destination, available balance and account connection. If you already approved this payment, check Activity before sending again.'
      : 'Check your account connection and request options, then try again. If you already shared a request, check Activity before replacing it.'}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ paddingVertical: t.spacing[2] }}>
      <Text style={{ ...secondary, color: t.colors.primary[500] }}>{expanded ? 'Hide error details' : 'Error details'}</Text>
    </TouchableOpacity>
    {expanded && <Text selectable style={secondary}>{message}</Text>}
  </View>;
}
