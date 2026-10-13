import React, { useEffect, useRef } from 'react';
import { Animated, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppLanguage } from '../localization/useAppLanguage';
import { Button } from './Button';

interface Props {
  visible: boolean;
  ticker: string;
  network?: string;
  account?: string;
  amountLabel?: string;
  amountIsBalanceChange?: boolean;
  onDone: () => void;
  onActivity?: () => void;
}

export default function DepositSuccessOverlay({ visible, ticker, network, account, amountLabel, amountIsBalanceChange, onDone, onActivity }: Props) {
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
  const row = (label: string, value: string) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[4] }}>
    <Text style={{ flex: 1, color: theme.colors.text.secondary }}>{label}</Text>
    <Text selectable style={{ flex: 2, textAlign: 'right', color: theme.colors.text.primary, fontWeight: '600' }}>{value}</Text>
  </View>;
  return <Animated.View accessibilityViewIsModal style={{ position: 'absolute', inset: 0, zIndex: 2000, backgroundColor: theme.colors.background.backdrop, justifyContent: 'center', padding: theme.spacing[5], opacity: fade }}>
    <ScrollView bounces={false} style={{ flexGrow: 0, maxHeight: '95%', borderRadius: theme.borderRadius.xl, backgroundColor: theme.colors.surface.primary }} contentContainerStyle={{ padding: theme.spacing[6], gap: theme.spacing[5] }}>
      <View style={{ alignItems: 'center', gap: theme.spacing[3] }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.success[500] }}>
          <Ionicons name="checkmark" size={32} color={theme.colors.text.inverse} />
        </View>
        <Text accessibilityRole="header" style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize.xl, fontWeight: '600' }}>{it ? 'Pagamento ricevuto' : 'Payment received'}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize['3xl'], fontWeight: '700', textAlign: 'center' }}>{amountLabel ? `+${amountLabel}` : ticker}</Text>
        {amountLabel && amountIsBalanceChange && <Text style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>{it ? 'Aumento del saldo rilevato' : 'Detected balance increase'}</Text>}
        {!amountLabel && <Text style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>{it ? 'Importo nei dettagli attività' : 'See Activity for the amount'}</Text>}
      </View>
      <View style={{ padding: theme.spacing[4], gap: theme.spacing[3], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.background.primary }}>
        {row(it ? 'Asset' : 'Asset', ticker)}
        {row(it ? 'Accreditato su' : 'Received in', account ?? (it ? 'Vedi attività' : 'See Activity'))}
        {!!network && network !== 'all layers' && row(it ? 'Tramite' : 'Via', network)}
      </View>
      <View style={{ gap: theme.spacing[2] }}>
        <Button title={it ? 'Fatto' : 'Done'} fullWidth onPress={onDone} />
        {!!onActivity && <Button title={it ? 'Vedi attività' : 'View in Activity'} variant="ghost" fullWidth onPress={onActivity} />}
      </View>
    </ScrollView>
  </Animated.View>;
}
