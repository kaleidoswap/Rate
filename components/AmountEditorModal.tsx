import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, ScrollView, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { Sheet } from './Sheet';
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

/**
 * Edits stay local until Save; opening or dismissing never replaces the QR.
 * With requestOptions it edits a Receive request (amount optional); without,
 * it asks for the amount to send (required).
 */
export function AmountEditorModal({ visible, onClose, initialSats, rates, bitcoinUnit = 'sats', requestOptions, onConfirm }: Props) {
  const t = useAppTheme();
  const [value, setValue] = useState('');
  const [fiat, setFiat] = useState(false);
  const [expirySeconds, setExpirySeconds] = useState(3600);
  const [showCountdown, setShowCountdown] = useState(false);
  const rate = rates.usd;
  const sending = !requestOptions;
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
  const valid = (empty && !sending) || !empty && Number.isFinite(numeric) && numeric > 0 && Number.isSafeInteger(sats) && sats > 0;
  const close = () => { Keyboard.dismiss(); onClose(); };
  const save = () => {
    if (!valid) return;
    feedback.select();
    onConfirm(empty ? 0 : sats, requestOptions ? { expirySeconds, showCountdown } : undefined);
    close();
  };
  const muted = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  const label = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600' as const };
  return <Sheet visible={visible} onClose={close} title={requestOptions ? 'Edit request' : 'Enter amount'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: t.spacing[4] }}>
      <Text style={label}>{sending ? 'Amount to send' : 'Amount · optional'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], borderBottomWidth: 1, borderColor: t.colors.border.light }}>
        <TextInput accessibilityLabel="Requested amount" value={value} keyboardType={bitcoinUnit === 'sats' && !fiat ? 'number-pad' : 'decimal-pad'}
          onChangeText={setValue} placeholder={sending ? '0' : 'Any amount'} autoFocus={sending} placeholderTextColor={t.colors.text.muted}
          style={{ flex: 1, minHeight: 56, fontSize: t.typography.fontSize['2xl'], color: t.colors.text.primary }} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Change amount entry unit" disabled={!rate} onPress={() => {
          if (valid && !empty) setValue(fiat ? tokenValue(sats) : ((sats / 1e8) * rate).toFixed(2));
          setFiat(v => !v);
        }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
          <Text style={label}>{fiat ? 'USD' : bitcoinUnit}</Text>
          {!!rate && <Ionicons name="swap-vertical" size={18} color={t.colors.text.secondary} />}
        </TouchableOpacity>
      </View>
      <Text style={muted}>{empty ? (sending ? 'This request has no amount: you choose how much to send.' : 'The sender chooses the amount.') : !valid ? 'Enter a valid amount of at least 1 sat.' : fiat ? `${tokenValue(sats)} ${bitcoinUnit}` : rate ? `≈ $${((sats / 1e8) * rate).toFixed(2)} USD` : `${sats.toLocaleString()} sats`}</Text>
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
        {!sending && <TouchableOpacity accessibilityRole="button" onPress={() => setValue('')} style={{ minHeight: 48, paddingHorizontal: t.spacing[4], justifyContent: 'center' }}><Text style={muted}>Clear amount</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" disabled={!valid} onPress={save} style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: t.borderRadius.lg, backgroundColor: t.colors.primary[500], opacity: valid ? 1 : 0.5 }}>
          <Text style={{ ...label, color: t.colors.text.inverse }}>{requestOptions ? 'Save request' : 'Set amount'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  </Sheet>;
}
export default AmountEditorModal;
