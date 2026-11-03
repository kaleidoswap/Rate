import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { MakerCatalog, MakerRoute } from '../../services/makerRoutes';

/** The preview and native app share these cards; only the app can execute. */
export function MakerRouteList({ catalog, connected, onChoose, onSavedRequest }: { catalog: MakerCatalog; connected: boolean; onChoose: (r: MakerRoute) => void; onSavedRequest?: () => void }) {
  const t = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<string>();
  const supported = catalog.routes.filter(r => r.action);
  const unavailable = catalog.routes.filter(r => !r.action);
  const small = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  const row = (r: MakerRoute) => <View key={r.id} style={{ padding: t.spacing[5], borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light, gap: t.spacing[3] }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] }}>
      <View style={{ width: 44, height: 44, borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.highlight, alignItems: 'center', justifyContent: 'center' }}>
        <Text accessible={false} style={{ color: r.action ? t.colors.primary[500] : t.colors.text.secondary, fontSize: t.typography.fontSize['2xl'] }}>{r.action === 'receive-arkade' ? '↙' : '↗'}</Text>
      </View>
      <View style={{ flex: 1, gap: t.spacing[1] }}>
        <Text style={{ color: t.colors.text.primary, fontWeight: '600', fontSize: t.typography.fontSize.base }}>{r.from}</Text>
        <Text style={small}>To {r.to}</Text>
      </View>
    </View>
    {r.action ? <>
      <Text style={small}>{r.action === 'receive-arkade' ? 'Create a Lightning request. Receive bitcoin in your Arkade wallet.' : 'Pay a Lightning request using your Arkade balance.'}</Text>
      <TouchableOpacity accessibilityRole="button" disabled={!connected && !onSavedRequest} accessibilityState={{ disabled: !connected && !onSavedRequest }} onPress={() => onSavedRequest ? onSavedRequest() : onChoose(r)} style={{ minHeight: 52, padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: connected ? t.colors.primary[500] : t.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: connected ? t.colors.text.inverse : t.colors.text.secondary, fontWeight: '600', textAlign: 'center' }}>{onSavedRequest ? 'View saved request' : connected ? r.action === 'send-arkade' ? 'Pay a Lightning invoice' : 'Receive into Arkade' : `Connect Arkade on ${catalog.network}`}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Fees and limits: ${r.from} to ${r.to}`} accessibilityState={{ expanded: details === r.id }} onPress={() => setDetails(details === r.id ? undefined : r.id)} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Text style={small}>{details === r.id ? 'Hide fees and limits −' : 'Fees and limits +'}</Text>
      </TouchableOpacity>
      {details === r.id && <View style={{ gap: t.spacing[2] }}>
        <Text style={small}>{r.feePercent}% provider fee · network fees quoted before payment</Text>
        <Text style={small}>Published range: {r.min.toLocaleString()}–{r.max.toLocaleString()} sats</Text>
        <Text style={small}>You review the final total before paying.</Text>
      </View>}
    </> : <><Text style={{ ...small, fontWeight: '600' }}>Not available in this app</Text><Text style={small}>{r.reason}</Text></>}
  </View>;
  return <View style={{ gap: t.spacing[3] }}>
    {supported.length ? supported.map(row) : <Text style={small}>No executable route is available from this maker right now.</Text>}
    {!!unavailable.length && <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ minHeight: 48, paddingHorizontal: t.spacing[2], justifyContent: 'center' }}><Text style={small}>{expanded ? 'Hide' : 'Show'} other routes ({unavailable.length})</Text></TouchableOpacity>}
    {expanded && unavailable.map(row)}
  </View>;
}
