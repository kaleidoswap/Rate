import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { MakerCatalog, MakerRoute } from '../../services/makerRoutes';

/** Also rendered by the mobile preview; no demo data enters the payment flow. */
export function MakerRouteList({ catalog, connected, onChoose }: { catalog: MakerCatalog; connected: boolean; onChoose: (r: MakerRoute) => void }) {
  const t = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const supported = catalog.routes.filter(r => r.action);
  const unavailable = catalog.routes.filter(r => !r.action);
  const row = (r: MakerRoute) => <View key={r.id} style={{ padding: t.spacing[4], borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, gap: t.spacing[2] }}>
    <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600' }}>{r.from} → {r.to}</Text>
    <Text style={{ color: t.colors.text.secondary }}>{r.action ? `${r.feePercent}% provider fee · network fees quoted before payment` : r.reason}</Text>
    {r.action && <Text style={{ color: t.colors.text.secondary }}>Published range: {r.min.toLocaleString()}–{r.max.toLocaleString()} sats</Text>}
    {r.action && <TouchableOpacity accessibilityRole="button" disabled={!connected} accessibilityState={{ disabled: !connected }} onPress={() => onChoose(r)} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: connected ? t.colors.primary[500] : t.colors.text.secondary, fontWeight: '600' }}>{connected ? r.action === 'send-arkade' ? 'Pay a Lightning invoice' : 'Receive into Arkade' : `Connect Arkade on ${catalog.network}`}</Text>
    </TouchableOpacity>}
  </View>;
  return <View style={{ gap: t.spacing[3] }}>
    {supported.length ? supported.map(row) : <Text style={{ color: t.colors.text.secondary }}>No executable route is available from this maker right now.</Text>}
    {!!unavailable.length && <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: t.colors.text.secondary }}>{expanded ? 'Hide' : 'Show'} other routes ({unavailable.length})</Text></TouchableOpacity>}
    {expanded && unavailable.map(row)}
  </View>;
}

