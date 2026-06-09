import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme';

export interface BalanceData {
  total_sats: number;
  priceUsd?: number;
  layers: Array<{ layer: string; btc_sats: number; assets?: Array<{ ticker?: string; balance?: number; amount?: number; settled?: number }> }>;
}

const LAYER_META: Record<string, { label: string; icon: string; color: string }> = {
  spark: { label: 'Spark', icon: 'flash', color: '#ff8a3d' },
  rln: { label: 'Lightning / RGB', icon: 'flash-outline', color: '#7c5cff' },
  arkade: { label: 'Arkade', icon: 'cube', color: '#3dd6a4' },
  liquid: { label: 'Liquid', icon: 'water', color: '#3d9bff' },
};
const meta = (l: string) => LAYER_META[l] ?? { label: l, icon: 'wallet', color: '#9aa0a6' };
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
        <LinearGradient colors={gradient(theme)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradient}>
          <View style={s.headRow}>
            <Text style={s.capLabel}>Total balance</Text>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
          </View>
          <Text style={s.total}>{data.total_sats.toLocaleString()} sats</Text>
          {usd > 0 && <Text style={s.usd}>≈ ${usd.toFixed(2)}</Text>}
        </LinearGradient>
        <View style={s.layers}>
          {data.layers.map((l) => {
            const m = meta(l.layer);
            return (
              <View key={l.layer} style={s.layerRow}>
                <View style={[s.dot, { backgroundColor: m.color }]} />
                <Text style={s.layerName}>{m.label}</Text>
                <Text style={s.layerSats}>{l.btc_sats.toLocaleString()} sats</Text>
              </View>
            );
          })}
        </View>
      </Pressable>
      <BalanceDetailModal visible={open} data={data} onClose={() => setOpen(false)} />
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
          <Pressable style={s.close} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={tx(theme, 'secondary')} />
          </Pressable>
          <Text style={s.sheetTitle}>Balance</Text>
          <Text style={s.sheetTotal}>{data.total_sats.toLocaleString()} sats</Text>
          {usd > 0 && <Text style={s.sheetUsd}>≈ ${usd.toFixed(2)}{data.priceUsd ? ` · BTC $${Math.round(data.priceUsd).toLocaleString()}` : ''}</Text>}
          <ScrollView style={{ alignSelf: 'stretch', marginTop: 16 }}>
            {data.layers.map((l) => {
              const m = meta(l.layer);
              const assets = (l.assets ?? []).filter((a) => a?.ticker && assetAmt(a) > 0);
              return (
                <View key={l.layer} style={s.detLayer}>
                  <View style={s.detHead}>
                    <View style={[s.iconChip, { backgroundColor: m.color + '22' }]}>
                      <Ionicons name={m.icon as any} size={15} color={m.color} />
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
const gradient = (t: Theme): [string, string] => (t as any)?.colors?.primary?.gradient ?? ['#7c5cff', '#5b8cff'];

const makeStyles = (t: Theme) => {
  const c = (t as any)?.colors ?? {};
  return StyleSheet.create({
    card: { marginTop: 8, borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c?.border?.subtle ?? 'rgba(255,255,255,0.12)' },
    pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
    gradient: { padding: 14 },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    capLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
    total: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 4 },
    usd: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
    layers: { backgroundColor: c?.surface?.elevated ?? 'rgba(255,255,255,0.04)', paddingHorizontal: 14, paddingVertical: 8 },
    layerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    layerName: { color: tx(t, 'secondary'), fontSize: 13, flex: 1 },
    layerSats: { color: tx(t, 'primary'), fontSize: 13, fontWeight: '600' },
    // modal
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c?.background?.primary ?? '#15161a', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, alignItems: 'center', maxHeight: '80%' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 14 },
    close: { position: 'absolute', top: 14, right: 16, padding: 4 },
    sheetTitle: { color: tx(t, 'secondary'), fontSize: 13, fontWeight: '600' },
    sheetTotal: { color: tx(t, 'primary'), fontSize: 28, fontWeight: '800', marginTop: 4 },
    sheetUsd: { color: tx(t, 'tertiary'), fontSize: 13, marginTop: 2 },
    detLayer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)', paddingVertical: 12 },
    detHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconChip: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    detName: { color: tx(t, 'primary'), fontSize: 15, fontWeight: '600' },
    detSats: { color: tx(t, 'primary'), fontSize: 15, fontWeight: '700' },
    detUsd: { color: tx(t, 'tertiary'), fontSize: 12, marginTop: 2, marginLeft: 36 },
    assetRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginLeft: 36 },
    assetTicker: { color: tx(t, 'secondary'), fontSize: 13 },
    assetAmt: { color: tx(t, 'primary'), fontSize: 13, fontWeight: '600' },
  });
};
