import { AllocationBar } from '../AllocationBar';
import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme';
import { RgbNodeIcon } from '../ProtocolIcons';

export interface BalanceData {
  total_sats: number;
  priceUsd?: number;
  layers: Array<{ layer: string; btc_sats: number; assets?: Array<{ ticker?: string; balance?: number; amount?: number; settled?: number }> }>;
}

// Layer dot colors map to the app's per-network "leg" palette
// (theme.colors.networks) so the chat balance card stays consistent with
// Send/Receive and the dashboard breakdown instead of an ad-hoc palette.
const LAYER_META: Record<string, { label: string; icon: string; net: string }> = {
  spark: { label: 'Spark', icon: 'flash', net: 'spark' },
  rln: { label: 'Lightning / RGB', icon: 'rln', net: 'lightning' },
  arkade: { label: 'Arkade', icon: 'cube', net: 'arkade' },
};
const meta = (t: Theme, l: string) => {
  const m = LAYER_META[l] ?? { label: l, icon: 'wallet', net: 'unified' };
  return { label: m.label, icon: m.icon, color: (t as any)?.colors?.networks?.[m.net] ?? '#9aa0a6' };
};
const usdOf = (sats: number, price?: number) => (price ? (sats / 1e8) * price : 0);
const assetAmt = (a: any) => Number(a?.balance ?? a?.amount ?? a?.settled ?? 0);

/** Compact balance card in chat: total + per-layer; tap → detail modal. */
export const BalanceCard: React.FC<{ data: BalanceData }> = ({ data }) => {
  const theme = useAppTheme();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(false);
  const usd = usdOf(data.total_sats, data.priceUsd);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [s.card, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel="Open balance details">
        <View style={s.summary}>
          <View style={s.headRow}>
            <Text style={s.capLabel}>Total balance</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.text.secondary} />
          </View>
          <Text style={s.total}>{data.total_sats.toLocaleString()} sats</Text>
          {usd > 0 && <Text style={s.usd}>≈ ${usd.toFixed(2)}</Text>}
          <View style={s.layers}>
            {data.layers.slice(0, 2).map((l) => {
              const m = meta(theme, l.layer);
              return <View key={l.layer} style={s.layerRow}>
                <View style={[s.dot, { backgroundColor: m.color }]} />
                <Text style={s.layerName}>{m.label}</Text>
                <Text style={s.layerSats}>{l.btc_sats.toLocaleString()} sats</Text>
              </View>;
            })}
            {data.layers.length > 2 && <Text style={s.usd}>+{data.layers.length - 2} more · View details</Text>}
          </View>
        </View>
      </Pressable>
      {open && <BalanceDetailModal visible data={data} onClose={() => setOpen(false)} />}
    </>
  );
};

const BalanceDetailModal: React.FC<{ visible: boolean; data: BalanceData; onClose: () => void }> = ({ visible, data, onClose }) => {
  const theme = useAppTheme();
  const s = makeStyles(theme);
  const usd = usdOf(data.total_sats, data.priceUsd);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <Pressable style={s.close} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close balance details">
            <Ionicons name="close" size={22} color={tx(theme, 'secondary')} />
          </Pressable>
          <Text style={s.sheetTitle}>Balance</Text>
          <Text style={s.sheetTotal}>{data.total_sats.toLocaleString()} sats</Text>
          {usd > 0 && <Text style={s.sheetUsd}>≈ ${usd.toFixed(2)}{data.priceUsd ? ` · BTC $${Math.round(data.priceUsd).toLocaleString()}` : ''}</Text>}
          <ScrollView style={{ alignSelf: 'stretch', marginTop: 16 }}>
            <AllocationBar items={data.layers.map(l => ({ label: meta(theme, l.layer).label, value: l.btc_sats, color: meta(theme, l.layer).color }))} />
            {data.layers.map((l) => {
              const m = meta(theme, l.layer);
              const assets = (l.assets ?? []).filter((a) => a?.ticker && assetAmt(a) > 0);
              return (
                <View key={l.layer} style={s.detLayer}>
                  <View style={s.detHead}>
                    <View style={[s.iconChip, { backgroundColor: m.color + '22' }]}>
                      {m.icon === 'rln'
                        ? <RgbNodeIcon size={16} badgeBackground={theme.colors.surface.primary} />
                        : <Ionicons name={m.icon as any} size={15} color={m.color} />}
                    </View>
                    <Text style={s.detName}>{m.label}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={s.detSats}>{l.btc_sats.toLocaleString()} sats</Text>
                  </View>
                  {usdOf(l.btc_sats, data.priceUsd) > 0 && <Text style={s.detUsd}>≈ ${usdOf(l.btc_sats, data.priceUsd).toFixed(2)}</Text>}
                  {assets.map((a, i) => (
                    <View key={i} style={s.assetRow}>
                      <Text style={s.assetTicker}>{a.ticker}</Text>
                      <Text style={s.assetAmt}>{assetAmt(a).toLocaleString()}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const tx = (t: Theme, k: 'primary' | 'secondary' | 'tertiary') => (t as any)?.colors?.text?.[k] ?? (k === 'primary' ? '#fff' : '#9aa0a6');

const makeStyles = (t: Theme) => {
  const c = (t as any)?.colors ?? {};
  return StyleSheet.create({
    card: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.border.light, backgroundColor: t.colors.surface.primary, minWidth: 220 },
    pressed: { opacity: 0.9 },
    summary: { padding: 14 },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    capLabel: { color: tx(t, 'secondary'), fontSize: 12, fontWeight: '500' },
    total: { color: tx(t, 'primary'), fontSize: 26, fontWeight: '700', marginTop: 4 },
    usd: { color: tx(t, 'secondary'), fontSize: 12, marginTop: 4 },
    layers: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border.light, paddingTop: 6 },
    layerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
    dot: { width: 8, height: 8, borderRadius: t.borderRadius.full, marginRight: t.spacing[2] },
    layerName: { color: tx(t, 'secondary'), fontSize: 12, flex: 1, marginRight: 8 },
    layerSats: { color: tx(t, 'primary'), fontSize: 12, fontWeight: t.typography.fontWeight.semibold },
    // modal
    backdrop: { flex: 1, backgroundColor: c?.background?.backdrop ?? 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c?.background?.primary, borderTopLeftRadius: t.borderRadius.xl, borderTopRightRadius: t.borderRadius.xl, paddingHorizontal: t.spacing[5], paddingTop: t.spacing[3], paddingBottom: t.spacing[8], alignItems: 'center', maxHeight: '80%' },
    handle: { width: 40, height: 4, borderRadius: t.borderRadius.sm, backgroundColor: c?.border?.dark ?? 'rgba(255,255,255,0.2)', marginBottom: t.spacing[3.5] },
    close: { position: 'absolute', top: t.spacing[3.5], right: t.spacing[4], padding: t.spacing[1] },
    sheetTitle: { color: tx(t, 'secondary'), fontSize: t.typography.fontSize.sm, fontWeight: t.typography.fontWeight.semibold },
    sheetTotal: { color: tx(t, 'primary'), fontSize: t.typography.fontSize['3xl'], fontWeight: t.typography.fontWeight.extrabold, marginTop: t.spacing[1] },
    sheetUsd: { color: tx(t, 'tertiary'), fontSize: t.typography.fontSize.sm, marginTop: 2 },
    detLayer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c?.border?.light ?? 'rgba(255,255,255,0.08)', paddingVertical: t.spacing[3] },
    detHead: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] },
    iconChip: { width: 28, height: 28, borderRadius: t.borderRadius.base, alignItems: 'center', justifyContent: 'center' },
    detName: { color: tx(t, 'primary'), fontSize: t.typography.fontSize.base, fontWeight: t.typography.fontWeight.semibold },
    detSats: { color: tx(t, 'primary'), fontSize: t.typography.fontSize.base, fontWeight: t.typography.fontWeight.bold },
    detUsd: { color: tx(t, 'tertiary'), fontSize: t.typography.fontSize.xs, marginTop: 2, marginLeft: 36 },
    assetRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: t.spacing[1.5], marginLeft: 36 },
    assetTicker: { color: tx(t, 'secondary'), fontSize: t.typography.fontSize.sm },
    assetAmt: { color: tx(t, 'primary'), fontSize: t.typography.fontSize.sm, fontWeight: t.typography.fontWeight.semibold },
  });
};
