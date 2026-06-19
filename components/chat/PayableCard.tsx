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
      marginTop: t.spacing[2],
      borderRadius: t.borderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c?.border?.subtle ?? c?.border?.default ?? c?.border?.medium,
      backgroundColor: c?.surface?.elevated ?? c?.background?.secondary,
      padding: t.spacing[3],
    },
    cardPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    // Violet-tinted icon/action chips — a deliberate secondary-brand-accent (brand.violet) card tint; kept as inline rgba so the alpha levels stay tunable.
    iconWrap: { width: 24, height: 24, borderRadius: t.borderRadius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,92,255,0.14)' },
    label: { color: c?.text?.primary ?? '#fff', fontSize: t.typography.fontSize.sm, fontWeight: t.typography.fontWeight.semibold, flex: 1 },
    amount: { color: accent(t), fontSize: t.typography.fontSize.sm, fontWeight: t.typography.fontWeight.bold },
    desc: { color: c?.text?.secondary ?? '#c2c6cc', fontSize: t.typography.fontSize.xs, marginTop: t.spacing[1.5] },
    mono: { color: c?.text?.tertiary ?? '#8a9099', fontSize: 11, fontFamily: 'Courier', marginTop: t.spacing[1.5] },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: t.spacing[2.5], gap: t.spacing[2] },
    meta: { color: c?.text?.tertiary ?? '#8a9099', fontSize: 11 },
    btn: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[1], paddingVertical: 5, paddingHorizontal: t.spacing[2.5], borderRadius: t.borderRadius.base, backgroundColor: 'rgba(124,92,255,0.12)' },
    btnPressed: { backgroundColor: 'rgba(124,92,255,0.22)' },
    btnText: { color: muted(t), fontSize: t.typography.fontSize.xs, fontWeight: t.typography.fontWeight.semibold },
  });
};
