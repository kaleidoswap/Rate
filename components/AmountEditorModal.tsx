import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, ScrollView, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { Sheet } from './Sheet';
import { AmountPad, groupComposedAmount } from './AmountPad';
import { OptionSheet } from './OptionSheet';
import { receiveAmountSats } from '../utils/receive-request';
import { feedback } from '../utils/feedback';

/** The symbol for a fiat code, shown next to amounts and in the currency picker. */
function fiatSymbolFor(code: string): string {
  const symbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: 'CHF ', CAD: 'CA$', AUD: 'A$' };
  return symbols[code] ?? code + ' ';
}

export interface ReceiveRequestOptions { expirySeconds: number; showCountdown: boolean; /** What it's for: the invoice description. */ note?: string }

/** Asset (non-bitcoin) amounts: a Spark token or an RGB asset, in display units. */
export interface AmountAssetContext {
  /** Ticker shown as the unit, e.g. USDB. */
  unit: string;
  /** Maximum sendable amount in display units, for the Max chip and validation. */
  maxUnits?: number;
  /** e.g. "123.45 USDB available", shown under the amount. */
  availableLabel?: string;
  /** Decimal places the asset uses (its precision). Default 8. */
  decimals?: number;
}
interface Props {
  visible: boolean;
  onClose: () => void;
  initialSats?: number;
  /** Asset mode: the amount already chosen, as a display-unit string. */
  initialAssetValue?: string;
  /** Present when the amount is in a Spark token or RGB asset instead of bitcoin. */
  asset?: AmountAssetContext;
  /** For bitcoin sends: the total spendable, shown as a Max chip. */
  maxSats?: number;
  rates: Record<string, number>;
  bitcoinUnit?: 'BTC' | 'sats';
  requestOptions?: ReceiveRequestOptions;
  onConfirm: (sats: number, options?: ReceiveRequestOptions) => void;
  /** Asset mode: returns the chosen amount in display units. */
  onConfirmAssetUnits?: (units: number) => void;
}

/**
 * Edits stay local until Save; opening or dismissing never replaces the QR.
 * With requestOptions it edits a Receive request (amount optional); without,
 * it asks for the amount to send (required). The same one amount editor
 * serves bitcoin (sats/USD toggle) and Spark/RGB assets (Max, no fiat).
 */
export function AmountEditorModal({ visible, onClose, initialSats, initialAssetValue, asset, maxSats, rates, bitcoinUnit = 'sats', requestOptions, onConfirm, onConfirmAssetUnits }: Props) {
  const t = useAppTheme();
  const [value, setValue] = useState('');
  const [fiat, setFiat] = useState(false);
  const [fiatCode, setFiatCode] = useState('USD');
  const [expirySeconds, setExpirySeconds] = useState(3600);
  const [showCountdown, setShowCountdown] = useState(false);
  const [showFiatPicker, setShowFiatPicker] = useState(false);
  const [note, setNote] = useState('');
  // Which fiat the user is typing in; tap the unit to cycle through the available ones.
  const availableFiats = Object.entries(rates).filter(([, v]) => !!v && v > 0).map(([code]) => code);
  const rate = rates[fiatCode] ?? rates.usd;
  const fiatSymbol = fiatSymbolFor(fiatCode);
  const sending = !requestOptions;
  const tokenValue = (sats: number) => bitcoinUnit === 'sats' ? String(sats) : (sats / 1e8).toFixed(8);
  useEffect(() => {
    if (!visible) return;
    setValue(asset ? (initialAssetValue ?? '') : initialSats ? tokenValue(initialSats) : '');
    setFiat(false);
    setExpirySeconds(requestOptions?.expirySeconds ?? 3600);
    setShowCountdown(requestOptions?.showCountdown ?? false);
    setNote(requestOptions?.note ?? '');
  }, [visible]);
  const numeric = Number(value.replace(',', '.'));
  // Asset mode: display units of a Spark token or RGB asset, no fiat conversion.
  const units = numeric;
  const sats = fiat ? Math.round(numeric / rate * 1e8) : receiveAmountSats(value.replace(',', '.'), bitcoinUnit);
  const empty = !value.trim();
  const overMax = asset?.maxUnits !== undefined && units > asset.maxUnits + 1e-9;
  const valid = asset
    ? !empty && Number.isFinite(units) && units > 0 && !overMax
    : (empty && !sending) || !empty && Number.isFinite(numeric) && numeric > 0 && Number.isSafeInteger(sats) && sats > 0;
  const close = () => { Keyboard.dismiss(); onClose(); };
  const save = () => {
    if (!valid) return;
    feedback.select();
    if (asset && onConfirmAssetUnits) onConfirmAssetUnits(units);
    else onConfirm(empty ? 0 : sats, requestOptions ? { expirySeconds, showCountdown, note: note.trim() } : undefined);
    close();
  };
  const maxLabel = asset?.maxUnits !== undefined ? String(asset.maxUnits).replace(/\.?0+$/, '') : '';
  const maxDecimals = asset ? Math.max(0, Math.min(8, asset.decimals ?? 8)) : fiat ? 2 : bitcoinUnit === 'BTC' ? 8 : 0;
  const muted = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  const label = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600' as const };
  const hint = asset
    ? empty ? `Enter how much ${asset.unit} to send.`
      : !Number.isFinite(units) || units <= 0 ? 'Enter a valid amount.'
      : overMax ? `Not enough ${asset.unit}${asset.availableLabel ? ` · ${asset.availableLabel}` : ''}.`
      : asset.availableLabel ?? ''
    : empty ? (sending ? (maxSats !== undefined && maxSats > 0 ? `Available: ${maxSats.toLocaleString('en-US')} ${bitcoinUnit}.` : 'This request has no amount: you choose how much to send.') : 'The sender chooses the amount.')
      : !valid ? 'Enter a valid amount of at least 1 sat.'
      : fiat ? `${tokenValue(sats)} ${bitcoinUnit}`
      : rate ? `≈ ${fiatSymbol}${((sats / 1e8) * rate).toFixed(2)} ${fiatCode}`
      : `${sats.toLocaleString('en-US')} sats`;
  return <Sheet visible={visible} onClose={close} title={requestOptions ? 'Edit request' : 'Enter amount'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: t.spacing[4] }}>
      <Text style={label}>{asset ? `Amount in ${asset.unit}` : sending ? 'Amount to send' : 'Amount · optional'}</Text>
      <View style={{ alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[2] }}>
        <Text accessibilityLabel="Requested amount" accessibilityLiveRegion="polite"
          style={{ fontSize: t.typography.fontSize['4xl'], fontWeight: '700', color: value ? t.colors.text.primary : t.colors.text.muted, fontVariant: ['tabular-nums'] }}>
          {value ? groupComposedAmount(value) : (sending ? '0' : 'Any amount')}
        </Text>
        {asset
          ? <Text style={muted}>{asset.unit}</Text>
          : <TouchableOpacity accessibilityRole="button" accessibilityLabel="Change amount entry unit" disabled={!rate} onPress={() => {
              // First tap: enter fiat mode with the current currency.
              // Tapping the currency label again opens the picker.
              if (!fiat) {
                // Convert the typed sats/BTC into the fiat currency before switching.
                if (valid && !empty) setValue(((sats / 1e8) * rate).toFixed(2));
                setFiat(true);
                return;
              }
              setShowFiatPicker(true);
            }} style={{ minHeight: 40, paddingHorizontal: t.spacing[4], justifyContent: 'center', borderRadius: t.borderRadius.full, backgroundColor: t.colors.surface.secondary, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], opacity: rate ? 1 : 0.5 }}>
            <Text style={label}>{fiat ? fiatCode : bitcoinUnit}</Text>
            {!!rate && <Ionicons name="swap-vertical" size={16} color={t.colors.text.secondary} />}
          </TouchableOpacity>}
      </View>
      <AmountPad value={value} onChange={setValue} maxDecimals={maxDecimals} />
      <Text style={muted}>{hint}</Text>
      {asset ? <View style={{ flexDirection: 'row', gap: t.spacing[2], flexWrap: 'wrap' }}>
        {asset.maxUnits !== undefined && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Send all ${asset.unit}`} onPress={() => { feedback.select(); setValue(maxLabel); }}
          style={{ minHeight: 40, paddingHorizontal: t.spacing[4], justifyContent: 'center', borderRadius: t.borderRadius.full, backgroundColor: t.colors.surface.secondary }}>
          <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>Max</Text>
        </TouchableOpacity>}
      </View> : null}
      {sending && !asset && maxSats !== undefined && maxSats > 0 && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Send the maximum" onPress={() => {
          feedback.select();
          // In fiat mode, convert the max sats into the active currency.
          if (fiat) setValue(((maxSats / 1e8) * rate).toFixed(2));
          else setValue(bitcoinUnit === 'sats' ? String(maxSats) : (maxSats / 1e8).toFixed(8));
        }}
          style={{ minHeight: 40, paddingHorizontal: t.spacing[4], justifyContent: 'center', borderRadius: t.borderRadius.full, backgroundColor: t.colors.surface.secondary, alignSelf: 'flex-start' }}>
          <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>Max</Text>
        </TouchableOpacity>
      )}
      {!sending && !asset && <View style={{ flexDirection: 'row', gap: t.spacing[2], flexWrap: 'wrap' }}>
        {!!rate && [1, 5, 20].map(usd => <TouchableOpacity key={usd} accessibilityRole="button" accessibilityLabel={`Request ${usd} dollars`}
          onPress={() => { feedback.select(); setFiat(true); setValue(String(usd)); }}
          style={{ minHeight: 40, paddingHorizontal: t.spacing[4], justifyContent: 'center', borderRadius: t.borderRadius.full, backgroundColor: t.colors.surface.secondary }}>
          <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>${usd}</Text>
        </TouchableOpacity>)}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Any amount: the sender decides" onPress={() => { feedback.select(); setValue(''); }}
          style={{ minHeight: 40, paddingHorizontal: t.spacing[4], justifyContent: 'center', borderRadius: t.borderRadius.full, backgroundColor: empty ? t.colors.primary[500] : t.colors.surface.secondary }}>
          <Text style={{ color: empty ? t.colors.text.inverse : t.colors.text.primary, fontWeight: '600' }}>Any amount</Text>
        </TouchableOpacity>
      </View>}
      {requestOptions && <>
        <Text style={label}>What is it for? · optional</Text>
        <TextInput accessibilityLabel="Request note" value={note} onChangeText={setNote} maxLength={120} placeholder="e.g. Pizza on Friday"
          placeholderTextColor={t.colors.text.muted} returnKeyType="done"
          style={{ minHeight: 48, paddingHorizontal: t.spacing[3], borderRadius: t.borderRadius.md, borderWidth: 1, borderColor: t.colors.border.light, color: t.colors.text.primary, fontSize: t.typography.fontSize.base }} />
        <Text style={muted}>Shown to the payer in the Lightning invoice.</Text>
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
        <TouchableOpacity accessibilityRole="button" disabled={!valid} onPress={save} style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: t.borderRadius.lg, backgroundColor: t.colors.primary[500], opacity: valid ? 1 : 0.5 }}>
          <Text style={{ ...label, color: t.colors.text.inverse }}>{requestOptions ? 'Save request' : 'Set amount'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    <OptionSheet
      visible={showFiatPicker}
      title="Currency"
      options={[
        { id: 'BTC', label: bitcoinUnit, description: bitcoinUnit === 'sats' ? 'Satoshis' : 'Bitcoin' },
        ...availableFiats.map(code => ({ id: code, label: code, description: fiatSymbolFor(code) })),
      ]}
      selectedId={fiat ? fiatCode : bitcoinUnit}
      onSelect={id => {
        if (id === 'BTC' || id === bitcoinUnit) {
          if (fiat && valid && !empty) setValue(tokenValue(sats));
          setFiat(false);
        } else {
          const nextRate = rates[id] ?? rates.usd;
          if (valid && !empty) setValue(((sats / 1e8) * nextRate).toFixed(2));
          setFiatCode(id);
          setFiat(true);
        }
      }}
      onClose={() => setShowFiatPicker(false)}
    />
  </Sheet>;
}
export default AmountEditorModal;
