import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme';
import { Payable, KIND_LABEL } from '../../utils/decodeInvoice';
import { shareLightningInvoice } from '../InvoiceQRCode';

const ICON: Record<Payable['kind'], string> = {
  bolt11: 'flash',
  onchain: 'link',
  rgb: 'diamond',
  lnaddress: 'at',
  lnurl: 'qr-code',
};

/** A rich card for a Lightning invoice / on-chain address / RGB invoice found in a chat message. */
export const PayableCard: React.FC<{ payable: Payable; onCopy: (text: string, label?: string) => void }> = ({ payable, onCopy }) => {
  const theme = useAppTheme();
  const s = makeStyles(theme);
  const { kind, raw, amountSats, description, expirySec } = payable;
  const short = raw.length > 28 ? `${raw.slice(0, 16)}…${raw.slice(-10)}` : raw;
  const share = () => {
    if (kind === 'bolt11') shareLightningInvoice({ invoice: raw, amount: amountSats ?? 0, description });
    else onCopy(raw, KIND_LABEL[kind]);
  };
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Ionicons name={ICON[kind] as any} size={15} color={accent(theme)} />
        <Text style={s.label}>{KIND_LABEL[kind]}</Text>
        {amountSats != null && <Text style={s.amount}>{amountSats.toLocaleString()} sats</Text>}
      </View>
      {!!description && <Text style={s.desc} numberOfLines={2}>{description}</Text>}
      <Text style={s.mono} numberOfLines={1}>{short}</Text>
      <View style={s.row}>
        {!!expirySec && kind === 'bolt11' && <Text style={s.meta}>expires in {Math.round(expirySec / 60)} min</Text>}
        <View style={{ flex: 1 }} />
        <Pressable style={s.btn} onPress={() => onCopy(raw, KIND_LABEL[kind])} hitSlop={6}>
          <Ionicons name="copy-outline" size={14} color={muted(theme)} />
          <Text style={s.btnText}>Copy</Text>
        </Pressable>
        <Pressable style={s.btn} onPress={share} hitSlop={6}>
          <Ionicons name="share-outline" size={14} color={muted(theme)} />
          <Text style={s.btnText}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
};

const accent = (t: Theme) => (t as any)?.colors?.primary?.main ?? '#7c5cff';
const muted = (t: Theme) => (t as any)?.colors?.text?.secondary ?? '#9aa0a6';

const makeStyles = (t: Theme) => {
  const c = (t as any)?.colors ?? {};
  return StyleSheet.create({
    card: {
      marginTop: 8,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c?.border?.subtle ?? c?.border?.default ?? 'rgba(255,255,255,0.12)',
      backgroundColor: c?.surface?.elevated ?? c?.background?.secondary ?? 'rgba(255,255,255,0.04)',
      padding: 12,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: { color: c?.text?.primary ?? '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
    amount: { color: accent(t), fontSize: 13, fontWeight: '700' },
    desc: { color: c?.text?.secondary ?? '#c2c6cc', fontSize: 12, marginTop: 6 },
    mono: { color: c?.text?.tertiary ?? '#8a9099', fontSize: 11, fontFamily: 'Courier', marginTop: 6 },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
    meta: { color: c?.text?.tertiary ?? '#8a9099', fontSize: 11 },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(124,92,255,0.12)' },
    btnText: { color: muted(t), fontSize: 12, fontWeight: '600' },
  });
};
