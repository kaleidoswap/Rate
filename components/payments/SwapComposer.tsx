import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { composerRoute, composerEstimate, legNetworks, type SwapLeg } from '../../services/swapComposer';
import type { MakerCatalog, MakerRoute } from '../../services/makerRoutes';

export function SwapComposer({ catalog, amount, onAmount, onRoute, onReview, busy, connected, savedRequest, onSavedRequest, onOtherAssets }: {
  catalog?: MakerCatalog; amount: string; onAmount: (s: string) => void; onRoute: (r: MakerRoute | undefined) => void;
  onReview: (r: MakerRoute, invoice: string) => void; busy: boolean; connected: boolean;
  savedRequest?: boolean; onSavedRequest?: () => void; onOtherAssets?: () => void;
}) {
  const t = useAppTheme();
  const [from, setFrom] = useState<SwapLeg>({ asset: 'Bitcoin', network: 'Arkade' });
  const [to, setTo] = useState<SwapLeg>({ asset: 'Bitcoin', network: 'Lightning' });
  const [picker, setPicker] = useState<string>(); const [invoice, setInvoice] = useState('');
  const route = composerRoute(catalog, from, to); const estimate = composerEstimate(route, amount);
  useEffect(() => { onRoute(route); }, [route]);
  const muted = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const panel = { backgroundColor: t.colors.surface.primary, borderRadius: t.borderRadius.xl, padding: t.spacing[4], gap: t.spacing[3], borderWidth: 1, borderColor: t.colors.border.light };
  const button = { minHeight: 48, padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.secondary, justifyContent: 'center' as const };
  const leg = (side: 'From' | 'To', value: SwapLeg, set: (l: SwapLeg) => void) => <View style={panel}>
    <Text style={muted}>{side}</Text>
    <View style={{ flexDirection: 'row', gap: t.spacing[2] }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${side} asset: ${value.asset}`} onPress={() => setPicker(picker === side + 'asset' ? undefined : side + 'asset')} style={{ ...button, flex: 1 }}><Text style={text}>{value.asset} ▾</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${side} network: ${value.network}`} onPress={() => setPicker(picker === side + 'network' ? undefined : side + 'network')} style={{ ...button, flex: 1 }}><Text style={text}>{value.network} ▾</Text></TouchableOpacity>
    </View>
    {picker === side + 'asset' && <View>{(['Bitcoin', 'USDT'] as const).map(asset => <TouchableOpacity key={asset} accessibilityRole="button" accessibilityLabel={`Select ${side.toLowerCase()} asset ${asset}`} onPress={() => { set({ asset, network: legNetworks(asset)[0] }); setPicker(undefined); }} style={button}><Text style={text}>{asset}</Text></TouchableOpacity>)}
      {onOtherAssets && <TouchableOpacity accessibilityRole="button" onPress={onOtherAssets} style={button}><Text style={text}>Other wallet assets · Spark / RGB</Text></TouchableOpacity>}
    </View>}
    {picker === side + 'network' && <View>{legNetworks(value.asset).map(network => <TouchableOpacity key={network} accessibilityRole="button" accessibilityLabel={`Select ${side.toLowerCase()} network ${network}`} onPress={() => { set({ ...value, network }); setPicker(undefined); setInvoice(''); }} style={button}><Text style={text}>{network}</Text></TouchableOpacity>)}</View>}
  </View>;
  const ready = !!route?.action && !estimate.error && connected && !busy && (!savedRequest) && (route.action !== 'send-arkade' || !!invoice.trim());
  return <View style={{ gap: t.spacing[3] }}>
    {savedRequest && <TouchableOpacity accessibilityRole="button" onPress={onSavedRequest} style={button}><Text style={{ ...text, color: t.colors.primary[500] }}>View saved swap</Text><Text style={muted}>Your previous request is kept. Check it before starting another.</Text></TouchableOpacity>}
    {leg('From', from, setFrom)}
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reverse swap direction" onPress={() => { setFrom(to); setTo(from); setInvoice(''); setPicker(undefined); }} style={{ ...button, alignSelf: 'center', paddingHorizontal: t.spacing[5] }}><Text style={text}>↓ ↑</Text></TouchableOpacity>
    {leg('To', to, setTo)}
    <View style={panel}>
      <Text style={muted}>{route?.action === 'receive-arkade' ? 'You receive' : 'Recipient receives'} · {to.asset === 'Bitcoin' ? 'sats' : 'asset units'}</Text>
      <TextInput accessibilityLabel="Swap amount in sats" keyboardType="number-pad" value={amount} onChangeText={onAmount} placeholder="0" placeholderTextColor={t.colors.text.tertiary} style={{ ...text, minHeight: 52, fontSize: t.typography.fontSize['2xl'] }} />
      {route?.action === 'send-arkade' && <><Text style={muted}>Lightning payment request</Text><TextInput accessibilityLabel="Swap Lightning invoice" value={invoice} onChangeText={setInvoice} autoCapitalize="none" autoCorrect={false} placeholder="Paste invoice" placeholderTextColor={t.colors.text.tertiary} style={{ ...text, minHeight: 52, backgroundColor: t.colors.surface.secondary, padding: t.spacing[3], borderRadius: t.borderRadius.lg }} /></>}
    </View>
    <View style={panel}>
      <Text style={text}>Estimated fee {estimate.fee == null ? '—' : `${estimate.fee.toLocaleString()} sats`}</Text>
      <Text style={{ ...text, fontWeight: '600' }}>Total to pay {estimate.total == null ? '—' : `${estimate.total.toLocaleString()} sats`}</Text>
      <Text style={muted}>Final fees and expiry are shown in review. No payment is sent now.</Text>
      <Text style={muted}>Provider · KaleidoSwap</Text>
      {route?.action === 'receive-arkade' && <Text style={muted}>Pay the generated request from your Lightning wallet to receive in Arkade.</Text>}
    </View>
    {!route?.action && catalog && <Text accessibilityRole="alert" style={muted}>{route?.reason ?? 'This asset and network combination is not available.'}</Text>}
    {!!amount && !!route?.action && estimate.error && <Text accessibilityRole="alert" style={muted}>{estimate.error}</Text>}
    {!connected && <Text style={muted}>Reconnect your Arkade wallet to request a quote.</Text>}
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={() => route && onReview(route, invoice.trim())} style={{ ...button, minHeight: 52, alignItems: 'center', backgroundColor: ready ? t.colors.primary[500] : t.colors.surface.secondary }}><Text style={{ ...text, color: ready ? t.colors.text.inverse : t.colors.text.secondary, fontWeight: '600' }}>{busy ? 'Checking…' : 'Review swap'}</Text></TouchableOpacity>
  </View>;
}
