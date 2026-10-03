import React, { useEffect, useRef, useState } from 'react';
import { Clipboard, Share, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { PaymentNetworkLabel } from '../payments/PaymentNetworkLabel';
import { feedback } from '../../utils/feedback';

/** Copy/share feedback belongs to the exact request, never to another method. */
export function ReceiveRequestActions({ value, label = 'Payment request', showValue = false }: {
  value: string; label?: string; showValue?: boolean;
}) {
  const t = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    generation.current++;
    setCopied(false); setExpanded(false); setError('');
    return () => { generation.current++; if (timer.current) clearTimeout(timer.current); };
  }, [value]);
  const copy = async () => {
    const current = generation.current;
    try {
      await Clipboard.setString(value);
      if (current !== generation.current) return;
      feedback.select(); setError(''); setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      if (current === generation.current) setError('Could not copy. Try again or share the request.');
    }
  };
  const share = async () => {
    const current = generation.current;
    try {
      await Share.share({ message: value, title: label });
      if (current === generation.current) setError('');
    }
    catch { if (current === generation.current) setError('Could not share. Try again or copy the request.'); }
  };
  const ink = t.colors.background.primary;
  const button = { minHeight: 48, borderRadius: t.borderRadius.lg, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: t.spacing[2], paddingHorizontal: t.spacing[4], paddingVertical: t.spacing[3] };
  return <View style={{ width: '100%', gap: t.spacing[3], paddingTop: t.spacing[3] }}>
    <PaymentNetworkLabel request={value} />
    {showValue && <View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${expanded ? 'Hide' : 'Show'} full ${label}`} accessibilityState={{ expanded }}
        onPress={() => setExpanded(v => !v)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
        <Text style={{ color: t.colors.text.secondary, flex: 1 }} numberOfLines={1}>{value.length > 38 ? `${value.slice(0, 18)}…${value.slice(-14)}` : value}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={t.colors.text.secondary} />
      </TouchableOpacity>
      {expanded && <Text selectable style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.sm }}>{value}</Text>}
    </View>}
    <View style={{ flexDirection: fontScale > 1.3 ? 'column' : 'row', gap: t.spacing[3] }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Copy ${label}`} disabled={!value} onPress={() => void copy()}
        style={[button, { flex: 1, backgroundColor: t.colors.primary[500], opacity: value ? 1 : 0.5 }]}>
        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={ink} />
        <Text style={{ color: ink, fontWeight: '600' }}>{copied ? 'Copied' : 'Copy request'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Share ${label}`} disabled={!value} onPress={() => void share()}
        style={[button, { backgroundColor: t.colors.surface.secondary, opacity: value ? 1 : 0.5 }]}>
        <Ionicons name="share-outline" size={18} color={t.colors.text.primary} />
        <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>Share</Text>
      </TouchableOpacity>
    </View>
    {!!error && <Text accessibilityRole="alert" style={{ color: t.colors.warning[500] }}>{error}</Text>}
  </View>;
}
