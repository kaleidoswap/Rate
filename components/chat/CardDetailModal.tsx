import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme';
import { Payable, KIND_LABEL } from '../../utils/decodeInvoice';
import { sharePayable, shareLightningInvoice } from '../InvoiceQRCode';

/** Bottom-sheet detail for a payable found in chat: big QR + full value + copy/share. */
export const CardDetailModal: React.FC<{
  visible: boolean;
  payable: Payable | null;
  onClose: () => void;
  onCopy: (text: string, label?: string) => void;
}> = ({ visible, payable, onClose, onCopy }) => {
  const theme = useAppTheme();
  const s = makeStyles(theme);
  if (!payable) return null;
  const { kind, raw, amountSats, description, expirySec, network } = payable;
  const share = () =>
    kind === 'bolt11'
      ? shareLightningInvoice({ invoice: raw, amount: amountSats ?? 0, description })
      : sharePayable(raw, KIND_LABEL[kind]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <Pressable style={s.close} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={tx(theme, 'secondary')} />
          </Pressable>

          <Text style={s.title}>{KIND_LABEL[kind]}</Text>
          {amountSats != null && <Text style={s.amount}>{amountSats.toLocaleString()} sats</Text>}
          {!!description && <Text style={s.desc}>{description}</Text>}

          <View style={s.qrWrap}>
            <QRCode value={raw} size={208} backgroundColor="#ffffff" color="#000000" />
          </View>

          {(expirySec || network) ? (
            <Text style={s.meta}>
              {expirySec && kind === 'bolt11' ? `Expires in ${Math.round(expirySec / 60)} min` : ''}
              {expirySec && network ? ' · ' : ''}
              {network ?? ''}
            </Text>
          ) : null}

          <ScrollView style={s.rawBox} contentContainerStyle={{ padding: 10 }} horizontal showsHorizontalScrollIndicator={false}>
            <Text style={s.raw} selectable>{raw}</Text>
          </ScrollView>

          <View style={s.row}>
            <Pressable style={[s.btn, s.btnGhost]} onPress={() => onCopy(raw, KIND_LABEL[kind])}>
              <Ionicons name="copy-outline" size={18} color={tx(theme, 'primary')} />
              <Text style={s.btnText}>Copy</Text>
            </Pressable>
            <Pressable style={s.btnPrimaryWrap} onPress={share}>
              <LinearGradient colors={gradient(theme)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btnPrimary}>
                <Ionicons name="share-outline" size={18} color="#fff" />
                <Text style={[s.btnText, { color: '#fff' }]}>Share</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const tx = (t: Theme, k: 'primary' | 'secondary' | 'tertiary') => (t as any)?.colors?.text?.[k] ?? (k === 'primary' ? '#fff' : '#9aa0a6');
const accent = (t: Theme) => (t as any)?.colors?.primary?.[500] ?? '#2BEE79';
const gradient = (t: Theme): [string, string] => (t as any)?.colors?.primary?.gradient ?? ['#2BEE79', '#2BEE79'];

const makeStyles = (t: Theme) => {
  const c = (t as any)?.colors ?? {};
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c?.background?.backdrop ?? 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c?.background?.primary ?? c?.surface?.elevated ?? '#15161a',
      borderTopLeftRadius: t.borderRadius.xl, borderTopRightRadius: t.borderRadius.xl,
      paddingHorizontal: t.spacing[5], paddingTop: t.spacing[3], paddingBottom: t.spacing[8], alignItems: 'center',
    },
    handle: { width: 40, height: 4, borderRadius: t.borderRadius.sm, backgroundColor: c?.border?.dark ?? 'rgba(255,255,255,0.2)', marginBottom: t.spacing[3.5] },
    close: { position: 'absolute', top: t.spacing[3.5], right: t.spacing[4], padding: t.spacing[1] },
    title: { color: tx(t, 'primary'), fontSize: t.typography.fontSize.base, fontWeight: t.typography.fontWeight.bold, marginBottom: 2 },
    amount: { color: accent(t), fontSize: t.typography.fontSize['2xl'], fontWeight: t.typography.fontWeight.extrabold, marginTop: 2 },
    desc: { color: tx(t, 'secondary'), fontSize: t.typography.fontSize.sm, marginTop: t.spacing[1.5], textAlign: 'center' },
    // QR must stay black-on-white for reliable scanning — these literals are intentional, not theme-able.
    qrWrap: { backgroundColor: '#fff', padding: t.spacing[4], borderRadius: t.borderRadius.lg, marginTop: t.spacing[4] },
    meta: { color: tx(t, 'tertiary'), fontSize: t.typography.fontSize.xs, marginTop: t.spacing[3] },
    rawBox: { maxHeight: 52, alignSelf: 'stretch', marginTop: t.spacing[3.5], borderRadius: t.borderRadius.base, backgroundColor: c?.surface?.secondary ?? 'rgba(255,255,255,0.05)' },
    raw: { color: tx(t, 'tertiary'), fontSize: t.typography.fontSize.xs, fontFamily: 'Courier' },
    row: { flexDirection: 'row', gap: t.spacing[3], marginTop: t.spacing[4], alignSelf: 'stretch' },
    btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing[1.5], paddingVertical: 13, borderRadius: t.borderRadius.md },
    btnGhost: { backgroundColor: c?.surface?.tertiary ?? 'rgba(255,255,255,0.08)' },
    btnPrimaryWrap: { flex: 1, borderRadius: t.borderRadius.md, overflow: 'hidden' },
    btnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing[1.5], paddingVertical: 13 },
    btnText: { color: tx(t, 'primary'), fontSize: t.typography.fontSize.base, fontWeight: t.typography.fontWeight.bold },
  });
};
