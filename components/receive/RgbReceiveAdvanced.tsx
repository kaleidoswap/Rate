import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { SegmentedTabs } from '../SegmentedTabs';
import { Callout } from '../Callout';
import { Button } from '../Button';
import { feedback } from '../../utils/feedback';
import {
  RGB_CONFIRMATION_PRESETS, RGB_EXPIRY_PRESETS, isDefaultRgbOptions, utxoCounts,
  type RgbInvoiceKind, type RgbReceiveOptions, type RgbReceiveSupport, type RgbUtxo,
} from '../../utils/rgb-receive';

export interface RgbUtxoState {
  loading: boolean;
  error?: string;
  list?: RgbUtxo[];
}

const expiryLabel = (seconds: number) =>
  RGB_EXPIRY_PRESETS.find(p => p.seconds === seconds)?.label
  ?? (seconds % 86_400 === 0 ? `${seconds / 86_400} days` : seconds % 3600 === 0 ? `${seconds / 3600} hours` : `${Math.round(seconds / 60)} min`);

/** The Advanced line's summary of what differs from the default invoice. */
export function rgbAdvancedSummary(options: RgbReceiveOptions, support: RgbReceiveSupport): string {
  if (isDefaultRgbOptions(options)) return 'Default';
  return [
    support.invoiceKind && options.kind === 'blinded' ? 'Blinded' : null,
    support.expiry && options.durationSeconds ? expiryLabel(options.durationSeconds) : null,
    support.minConfirmations && options.minConfirmations !== 1 ? `${options.minConfirmations} confirmations` : null,
  ].filter(Boolean).join(' · ') || 'Default';
}

/** RGB invoice options the RGB account supports, collapsed by default; anything unsupported is not shown. */
export function RgbReceiveAdvanced({ support, options, onChange, requestExpirySeconds, utxos, onLoadUtxos, onCreateUtxos }: {
  support: RgbReceiveSupport;
  options: RgbReceiveOptions;
  onChange: (options: RgbReceiveOptions) => void;
  /** The expiry the invoice gets when none is picked here. */
  requestExpirySeconds: number;
  utxos: RgbUtxoState | null;
  onLoadUtxos: () => void;
  onCreateUtxos?: () => void;
}) {
  const t = useAppTheme();
  const [open, setOpen] = useState(false);
  if (!support.invoiceKind && !support.expiry && !support.minConfirmations && !support.listUtxos) return null;

  const caption = (text: string) => (
    <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 }}>{text}</Text>
  );
  const hint = (text: string, warn = false) => (
    <Text style={{ color: warn ? t.colors.warning[500] : t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{text}</Text>
  );
  const counts = utxos?.list ? utxoCounts(utxos.list) : null;
  const expiry = options.durationSeconds ?? requestExpirySeconds;
  const toggle = () => {
    feedback.select();
    if (!open && support.listUtxos && !utxos) onLoadUtxos();
    setOpen(!open);
  };

  return (
    <View style={{ width: '100%', marginTop: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1, borderColor: t.colors.border.light, backgroundColor: t.colors.surface.primary }}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`Advanced RGB options: ${rgbAdvancedSummary(options, support)}`}
        onPress={toggle} activeOpacity={0.7}
        style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], paddingHorizontal: t.spacing[4] }}>
        <Ionicons name="options-outline" size={16} color={t.colors.text.secondary} />
        <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>Advanced</Text>
        <Text style={{ flex: 1, textAlign: 'right', color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }} numberOfLines={1}>
          {rgbAdvancedSummary(options, support)}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.text.secondary} />
      </TouchableOpacity>

      {open && <View style={{ gap: t.spacing[3], paddingHorizontal: t.spacing[4], paddingBottom: t.spacing[4] }}>
        {support.invoiceKind && <View style={{ gap: t.spacing[2] }}>
          {caption('Invoice type')}
          <SegmentedTabs<RgbInvoiceKind> scrollable={false} fill
            options={[{ key: 'witness', label: 'Witness' }, { key: 'blinded', label: 'Blinded' }]}
            value={options.kind} onChange={(kind) => onChange({ ...options, kind })} />
          {hint(options.kind === 'witness'
            ? 'The sender creates the output the asset lands on and adds a little bitcoin for it. Nothing to prepare here.'
            : 'The asset lands on one of your free UTXOs, and the sender never learns which. Needs a free UTXO.')}
          {options.kind === 'blinded' && counts?.free === 0 && <Callout tone="warning"
            message={support.createUtxos
              ? 'No free UTXO to receive into. Create some below, or use Witness.'
              : 'No free UTXO to receive into. Use Witness, or create UTXOs on your node.'} />}
        </View>}

        {support.expiry && <View style={{ gap: t.spacing[2] }}>
          {caption('Expires in')}
          <SegmentedTabs<string> scrollable={false} fill
            options={RGB_EXPIRY_PRESETS.map(p => ({ key: String(p.seconds), label: p.label }))}
            value={String(expiry)}
            onChange={(key) => onChange({ ...options, durationSeconds: Number(key) === requestExpirySeconds ? null : Number(key) })} />
        </View>}

        {support.minConfirmations && <View style={{ gap: t.spacing[2] }}>
          {caption('Confirmations')}
          <SegmentedTabs<string> scrollable={false} fill
            options={RGB_CONFIRMATION_PRESETS.map(n => ({ key: String(n), label: n === 1 ? '1 block' : `${n} blocks` }))}
            value={String(options.minConfirmations)}
            onChange={(key) => onChange({ ...options, minConfirmations: Number(key) })} />
          {hint('How many blocks the sender’s transaction needs before the asset counts as received.')}
        </View>}

        {support.listUtxos && <View style={{ gap: t.spacing[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {caption('UTXOs')}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh UTXOs" onPress={onLoadUtxos} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="refresh" size={14} color={t.colors.text.tertiary} />
            </TouchableOpacity>
          </View>
          {utxos?.loading && <ActivityIndicator size="small" color={t.colors.primary[500]} />}
          {!utxos?.loading && utxos?.error && hint(utxos.error, true)}
          {!utxos?.loading && counts && <>
            {hint(`${counts.free} free of ${counts.colorable} colorable UTXO${counts.colorable === 1 ? '' : 's'}`, counts.free === 0 && options.kind === 'blinded')}
            {utxos!.list!.filter(u => u.colorable).slice(0, 6).map(u => (
              <View key={u.outpoint} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[2] }}>
                <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs, flexShrink: 1 }} numberOfLines={1} ellipsizeMode="middle">{u.outpoint}</Text>
                <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>
                  {u.sats.toLocaleString()} sats · {u.allocations || u.pending ? 'in use' : 'free'}
                </Text>
              </View>
            ))}
          </>}
          {support.createUtxos && onCreateUtxos && <Button title="Create UTXOs" variant="secondary" size="sm" onPress={onCreateUtxos}
            icon={<Ionicons name="add-circle-outline" size={16} color={t.colors.text.primary} />} />}
        </View>}
      </View>}
    </View>
  );
}
