import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, Switch, KeyboardAvoidingView, Platform, ScrollView, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { receiveAmountSats } from '../utils/receive-request';
import { feedback } from '../utils/feedback';

export interface ReceiveRequestOptions { expirySeconds: number; showCountdown: boolean }
interface Props {
  visible: boolean;
  onClose: () => void;
  initialSats?: number;
  rates: Record<string, number>;
  bitcoinUnit?: 'BTC' | 'sats';
  requestOptions?: ReceiveRequestOptions;
  onConfirm: (sats: number, options?: ReceiveRequestOptions) => void;
}

/** Edits stay local until Save; opening or dismissing never replaces the QR. */
export function AmountEditorModal({ visible, onClose, initialSats, rates, bitcoinUnit = 'sats', requestOptions, onConfirm }: Props) {
  const t = useAppTheme();
  const [value, setValue] = useState('');
  const [fiat, setFiat] = useState(false);
  const [expirySeconds, setExpirySeconds] = useState(3600);
  const [showCountdown, setShowCountdown] = useState(false);
  const rate = rates.usd;
  const tokenValue = (sats: number) => bitcoinUnit === 'sats' ? String(sats) : (sats / 1e8).toFixed(8);
  useEffect(() => {
    if (!visible) return;
    setValue(initialSats ? tokenValue(initialSats) : '');
    setFiat(false);
    setExpirySeconds(requestOptions?.expirySeconds ?? 3600);
    setShowCountdown(requestOptions?.showCountdown ?? false);
  }, [visible]);
  const numeric = Number(value.replace(',', '.'));
  const sats = fiat ? Math.round(numeric / rate * 1e8) : receiveAmountSats(value.replace(',', '.'), bitcoinUnit);
  const empty = !value.trim();
  const valid = empty || Number.isFinite(numeric) && numeric > 0 && Number.isSafeInteger(sats) && sats > 0;
  const close = () => { Keyboard.dismiss(); onClose(); };
  const save = () => {
    if (!valid) return;
    feedback.select();
    onConfirm(empty ? 0 : sats, requestOptions ? { expirySeconds, showCountdown } : undefined);
    close();
  };
  const muted = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  const label = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600' as const };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: t.colors.background.backdrop }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss request editor" onPress={close} style={{ flex: 1 }} />
      <View style={{ maxHeight: '85%', backgroundColor: t.colors.surface.primary, borderTopLeftRadius: t.borderRadius.xl, borderTopRightRadius: t.borderRadius.xl }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[5], paddingBottom: t.spacing[8], gap: t.spacing[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text accessibilityRole="header" style={{ ...label, fontSize: t.typography.fontSize.xl }}>{requestOptions ? 'Edit request' : 'Enter amount'}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close request editor" onPress={close} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="close" size={24} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <Text style={label}>Amount · optional</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], borderBottomWidth: 1, borderColor: t.colors.border.light }}>
            <TextInput accessibilityLabel="Requested amount" value={value} keyboardType={bitcoinUnit === 'sats' && !fiat ? 'number-pad' : 'decimal-pad'}
              onChangeText={setValue} placeholder="Any amount" placeholderTextColor={t.colors.text.muted}
              style={{ flex: 1, minHeight: 56, fontSize: t.typography.fontSize['2xl'], color: t.colors.text.primary }} />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Change amount entry unit" disabled={!rate} onPress={() => {
              if (valid && !empty) setValue(fiat ? tokenValue(sats) : ((sats / 1e8) * rate).toFixed(2));
              setFiat(v => !v);
            }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
              <Text style={label}>{fiat ? 'USD' : bitcoinUnit}</Text>
              {!!rate && <Ionicons name="swap-vertical" size={18} color={t.colors.text.secondary} />}
            </TouchableOpacity>
          </View>
          <Text style={muted}>{!valid ? 'Enter a valid amount of at least 1 sat.' : empty ? 'The sender chooses the amount.' : fiat ? `${tokenValue(sats)} ${bitcoinUnit}` : rate ? `≈ $${((sats / 1e8) * rate).toFixed(2)} USD` : `${sats.toLocaleString()} sats`}</Text>
          {requestOptions && <>
            <Text style={label}>Invoice expiry</Text>
            <View style={{ flexDirection: 'row', gap: t.spacing[2], flexWrap: 'wrap' }}>
              {([[600, '10 min'], [3600, '1 hour'], [86400, '24 hours']] as const).map(([seconds, title]) => <TouchableOpacity key={seconds}
                accessibilityRole="radio" accessibilityLabel={`Expire after ${title}`} accessibilityState={{ checked: expirySeconds === seconds }} onPress={() => setExpirySeconds(seconds)}
                style={{ minHeight: 44, paddingHorizontal: t.spacing[4], justifyContent: 'center', borderRadius: t.borderRadius.md, backgroundColor: expirySeconds === seconds ? t.colors.primary[500] : t.colors.surface.secondary }}>
                <Text style={{ color: expirySeconds === seconds ? t.colors.text.inverse : t.colors.text.primary }}>{title}</Text>
              </TouchableOpacity>)}
            </View>
            <Text style={muted}>Applies to new invoices. The wallet may limit the duration; addresses do not expire.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={label}>Show countdown</Text>
              <Switch accessibilityLabel="Show expiry countdown" value={showCountdown} onValueChange={setShowCountdown} />
            </View>
          </>}
          <View style={{ flexDirection: 'row', gap: t.spacing[3] }}>
            <TouchableOpacity accessibilityRole="button" onPress={() => setValue('')} style={{ minHeight: 48, paddingHorizontal: t.spacing[4], justifyContent: 'center' }}><Text style={muted}>Clear amount</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={!valid} onPress={save} style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: t.borderRadius.lg, backgroundColor: t.colors.primary[500], opacity: valid ? 1 : 0.5 }}>
              <Text style={{ ...label, color: t.colors.text.inverse }}>{requestOptions ? 'Save request' : 'Set amount'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
export default AmountEditorModal;
