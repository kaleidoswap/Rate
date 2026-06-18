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
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c?.background?.primary ?? c?.surface?.elevated ?? '#15161a',
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, alignItems: 'center',
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 14 },
    close: { position: 'absolute', top: 14, right: 16, padding: 4 },
    title: { color: tx(t, 'primary'), fontSize: 16, fontWeight: '700', marginBottom: 2 },
    amount: { color: accent(t), fontSize: 22, fontWeight: '800', marginTop: 2 },
    desc: { color: tx(t, 'secondary'), fontSize: 13, marginTop: 6, textAlign: 'center' },
    qrWrap: { backgroundColor: '#fff', padding: 16, borderRadius: 16, marginTop: 18 },
    meta: { color: tx(t, 'tertiary'), fontSize: 12, marginTop: 12 },
    rawBox: { maxHeight: 52, alignSelf: 'stretch', marginTop: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
    raw: { color: tx(t, 'tertiary'), fontSize: 12, fontFamily: 'Courier' },
    row: { flexDirection: 'row', gap: 12, marginTop: 18, alignSelf: 'stretch' },
    btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 14 },
    btnGhost: { backgroundColor: 'rgba(255,255,255,0.08)' },
    btnPrimaryWrap: { flex: 1, borderRadius: 14, overflow: 'hidden' },
    btnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13 },
    btnText: { color: tx(t, 'primary'), fontSize: 15, fontWeight: '700' },
  });
};
