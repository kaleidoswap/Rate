import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { SegmentedTabs } from '../SegmentedTabs';
import { Callout } from '../Callout';
import { Button } from '../Button';
import {
  RGB_CONFIRMATION_PRESETS, rgbExpiryPresets, rgbReceiveExpiry, utxoCounts,
  type RgbInvoiceKind, type RgbReceiveOptions, type RgbReceiveSupport, type RgbUtxo,
} from '../../utils/rgb-receive';

export interface RgbUtxoState {
  loading: boolean;
  error?: string;
  list?: RgbUtxo[];
}

export function RgbInvoiceOptions({ support, options, onChange, requestExpirySeconds, proxyV1 = false, utxos, onLoadUtxos, onCreateUtxos }: {
  support: RgbReceiveSupport;
  options: RgbReceiveOptions;
  onChange: (options: RgbReceiveOptions) => void;
  /** The expiry the invoice gets when none is picked here. */
  requestExpirySeconds: number;
  proxyV1?: boolean;
  utxos: RgbUtxoState | null;
  onLoadUtxos: () => void;
  onCreateUtxos?: () => void;
}) {
  const t = useAppTheme();
  if (!support.invoiceKind && !support.expiry && !support.minConfirmations) return null;

  const caption = (text: string) => (
    <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 }}>{text}</Text>
  );
  const hint = (text: string, warn = false) => (
    <Text style={{ color: warn ? t.colors.warning[500] : t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{text}</Text>
  );
  const counts = utxos?.list ? utxoCounts(utxos.list) : null;
  const expiry = rgbReceiveExpiry(options.durationSeconds ?? requestExpirySeconds, proxyV1);
  const selectKind = (kind: RgbInvoiceKind) => {
    if (kind === options.kind) return;
    onChange({ ...options, kind });
    if (kind === 'blinded' && support.listUtxos && !utxos) onLoadUtxos();
  };

  return (
    <View style={{ gap: t.spacing[3], padding: t.spacing[4], marginTop: t.spacing[3], borderRadius: t.borderRadius.lg,
      borderWidth: 1, borderColor: t.colors.border.light, backgroundColor: t.colors.surface.primary }}>
      <Text accessibilityRole="header" style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '700' }}>Invoice options</Text>
      {support.invoiceKind && <View style={{ gap: t.spacing[2] }}>
        {caption('Invoice type')}
        <SegmentedTabs<RgbInvoiceKind> scrollable={false} fill
          options={[{ key: 'witness', label: 'Standard' }, { key: 'blinded', label: 'Private' }]}
          value={options.kind} onChange={selectKind} />
        {hint(options.kind === 'witness'
          ? 'Witness invoice. The sender covers the receiving output.'
          : 'Blinded invoice. Hides the receiving output and needs a free receive slot.')}
        {options.kind === 'blinded' && counts?.free === 0 && <Callout tone="warning"
          message={support.createUtxos
            ? 'No free receive slot. Create some below, or switch to Standard.'
            : 'No free receive slot. Switch to Standard, or create slots on your node.'} />}
      </View>}
      {support.expiry && <View style={{ gap: t.spacing[2] }}>
        {caption('Expires in')}
        <SegmentedTabs<string>
          options={rgbExpiryPresets(proxyV1).map(p => ({ key: String(p.seconds), label: p.label }))}
          value={String(expiry)}
          onChange={(key) => onChange({ ...options, durationSeconds: Number(key) === rgbReceiveExpiry(requestExpirySeconds, proxyV1) ? null : Number(key) })} />
      </View>}
      {support.minConfirmations && <View style={{ gap: t.spacing[2] }}>
        {caption('Confirmations')}
        <SegmentedTabs<string> scrollable={false} fill
          options={RGB_CONFIRMATION_PRESETS.map(n => ({ key: String(n), label: n === 1 ? '1 block' : `${n} blocks` }))}
          value={String(options.minConfirmations)}
          onChange={(key) => onChange({ ...options, minConfirmations: Number(key) })} />
        {hint('How many blocks the sender’s transaction needs before the asset counts as received.')}
      </View>}
      {support.listUtxos && options.kind === 'blinded' && <View style={{ gap: t.spacing[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {caption('Receive slots')}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh receive slots" onPress={onLoadUtxos} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="refresh" size={14} color={t.colors.text.tertiary} />
          </TouchableOpacity>
        </View>
        {utxos?.loading && <ActivityIndicator size="small" color={t.colors.primary[500]} />}
        {!utxos?.loading && utxos?.error && hint(utxos.error, true)}
        {!utxos?.loading && counts && <>
          {hint(`${counts.free} free of ${counts.colorable} receive slot${counts.colorable === 1 ? '' : 's'}`, counts.free === 0 && options.kind === 'blinded')}
          {utxos!.list!.filter(u => u.colorable).slice(0, 6).map((u, i) => (
            <View key={u.outpoint} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[2] }}>
              <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs, flexShrink: 1 }}>Slot {i + 1}</Text>
              <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>
                {u.sats.toLocaleString('en-US')} sats · {u.allocations || u.pending ? 'in use' : 'free'}
              </Text>
            </View>
          ))}
        </>}
        {support.createUtxos && onCreateUtxos && <Button title="Create receive slots" variant="secondary" size="sm" onPress={onCreateUtxos}
          icon={<Ionicons name="add-circle-outline" size={16} color={t.colors.text.primary} />} />}
      </View>}
    </View>
  );
}
