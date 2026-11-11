import React, { useEffect, useRef } from 'react';
import { Animated, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppLanguage } from '../localization/useAppLanguage';
import { Button } from './Button';

export interface SuccessRow { label: string; value: string }

interface Props {
  visible: boolean;
  title: string;
  /** The big line under the title, e.g. "+12,000 sats" or "2,100 sats". */
  amountLabel?: string;
  /** A muted line under the amount, e.g. "to Mario". */
  subtitle?: string;
  /** Detail lines between the amount and the buttons. */
  rows?: SuccessRow[];
  onDone: () => void;
  /** Defaults to the localized "Done". */
  doneLabel?: string;
  /** The second button, e.g. "View in Activity" or "See receipt". */
  secondary?: { label: string; onPress: () => void };
}

/**
 * The one celebratory overlay: a payment or deposit lands, the check marks
 * the moment, the amount stands big in the middle, the details follow. Used
 * by both Receive (a deposit arrives) and Send (the payment completes).
 */
export default function PaymentSuccessOverlay({ visible, title, amountLabel, subtitle, rows = [], onDone, doneLabel, secondary }: Props) {
  const theme = useAppTheme();
  const { language } = useAppLanguage();
  const it = language === 'it';
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(fade, { toValue: visible ? 1 : 0, duration: 220, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [visible, fade]);
  if (!visible) return null;
  const row = (label: string, value: string) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[4] }}>
    <Text style={{ flex: 1, color: theme.colors.text.secondary }}>{label}</Text>
    <Text selectable style={{ flex: 2, textAlign: 'right', color: theme.colors.text.primary, fontWeight: '600' }}>{value}</Text>
  </View>;
  return <Animated.View accessibilityViewIsModal style={{ position: 'absolute', inset: 0, zIndex: 2000, backgroundColor: theme.colors.background.backdrop, justifyContent: 'center', padding: theme.spacing[5], opacity: fade }}>
    <ScrollView bounces={false} style={{ flexGrow: 0, maxHeight: '95%', borderRadius: theme.borderRadius.xl, backgroundColor: theme.colors.surface.primary }} contentContainerStyle={{ padding: theme.spacing[6], gap: theme.spacing[5] }}>
      <View style={{ alignItems: 'center', gap: theme.spacing[3] }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.success[500] }}>
          <Ionicons name="checkmark" size={32} color={theme.colors.text.inverse} />
        </View>
        <Text accessibilityRole="header" style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize.xl, fontWeight: '600' }}>{title}</Text>
        {!!amountLabel && <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize['3xl'], fontWeight: '700', textAlign: 'center' }}>{amountLabel}</Text>}
        {!!subtitle && <Text style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>{subtitle}</Text>}
      </View>
      {rows.length > 0 && <View style={{ padding: theme.spacing[4], gap: theme.spacing[3], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.background.primary }}>
        {rows.map(r => row(r.label, r.value))}
      </View>}
      <View style={{ gap: theme.spacing[2] }}>
        <Button title={doneLabel ?? (it ? 'Fatto' : 'Done')} fullWidth onPress={onDone} />
        {!!secondary && <Button title={secondary.label} variant="ghost" fullWidth onPress={secondary.onPress} />}
      </View>
    </ScrollView>
  </Animated.View>;
}
