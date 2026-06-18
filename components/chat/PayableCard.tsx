import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme';
import { Payable, KIND_LABEL } from '../../utils/decodeInvoice';
import { shareLightningInvoice, sharePayable } from '../InvoiceQRCode';
import { CardDetailModal } from './CardDetailModal';

const ICON: Record<Payable['kind'], string> = {
  bolt11: 'flash',
  onchain: 'link',
  rgb: 'diamond',
  lnaddress: 'at',
  lnurl: 'qr-code',
};

/** A rich, tappable card for a Lightning invoice / address / RGB invoice in chat. */
export const PayableCard: React.FC<{ payable: Payable; onCopy: (text: string, label?: string) => void }> = ({ payable, onCopy }) => {
  const theme = useAppTheme();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(false);
  const { kind, raw, amountSats, description, expirySec } = payable;
  const short = raw.length > 28 ? `${raw.slice(0, 16)}…${raw.slice(-10)}` : raw;
  const share = () =>
    kind === 'bolt11' ? shareLightningInvoice({ invoice: raw, amount: amountSats ?? 0, description }) : sharePayable(raw, KIND_LABEL[kind]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [s.card, pressed && s.cardPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${KIND_LABEL[kind]} details`}
      >
        <View style={s.head}>
          <View style={s.iconWrap}>
            <Ionicons name={ICON[kind] as any} size={14} color={accent(theme)} />
          </View>
          <Text style={s.label}>{KIND_LABEL[kind]}</Text>
          {amountSats != null && <Text style={s.amount}>{amountSats.toLocaleString()} sats</Text>}
          <Ionicons name="chevron-forward" size={15} color={muted(theme)} style={{ marginLeft: 4 }} />
        </View>
        {!!description && <Text style={s.desc} numberOfLines={2}>{description}</Text>}
        <Text style={s.mono} numberOfLines={1}>{short}</Text>
        <View style={s.row}>
          {!!expirySec && kind === 'bolt11' && <Text style={s.meta}>expires in {Math.round(expirySec / 60)} min</Text>}
          <View style={{ flex: 1 }} />
          <Pressable style={({ pressed }) => [s.btn, pressed && s.btnPressed]} onPress={() => onCopy(raw, KIND_LABEL[kind])} hitSlop={6}>
            <Ionicons name="copy-outline" size={14} color={muted(theme)} />
            <Text style={s.btnText}>Copy</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [s.btn, pressed && s.btnPressed]} onPress={share} hitSlop={6}>
            <Ionicons name="share-outline" size={14} color={muted(theme)} />
            <Text style={s.btnText}>Share</Text>
          </Pressable>
        </View>
      </Pressable>
      <CardDetailModal visible={open} payable={payable} onClose={() => setOpen(false)} onCopy={onCopy} />
    </>
  );
};

const accent = (t: Theme) => (t as any)?.colors?.primary?.[500] ?? '#2BEE79';
const muted = (t: Theme) => (t as any)?.colors?.text?.secondary ?? '#9aa0a6';

const makeStyles = (t: Theme) => {
  const c = (t as any)?.colors ?? {};
  return StyleSheet.create({
    card: {
      marginTop: 8,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c?.border?.subtle ?? c?.border?.default ?? 'rgba(255,255,255,0.12)',
      backgroundColor: c?.surface?.elevated ?? c?.background?.secondary ?? 'rgba(255,255,255,0.04)',
      padding: 12,
    },
    cardPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    iconWrap: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,92,255,0.14)' },
    label: { color: c?.text?.primary ?? '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
    amount: { color: accent(t), fontSize: 13, fontWeight: '700' },
    desc: { color: c?.text?.secondary ?? '#c2c6cc', fontSize: 12, marginTop: 6 },
    mono: { color: c?.text?.tertiary ?? '#8a9099', fontSize: 11, fontFamily: 'Courier', marginTop: 6 },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
    meta: { color: c?.text?.tertiary ?? '#8a9099', fontSize: 11 },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 9, backgroundColor: 'rgba(124,92,255,0.12)' },
    btnPressed: { backgroundColor: 'rgba(124,92,255,0.22)' },
    btnText: { color: muted(t), fontSize: 12, fontWeight: '600' },
  });
};
