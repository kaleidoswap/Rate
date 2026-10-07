// components/map/PlaceDetailSheet.tsx
import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../../theme';
import { Sheet } from '../Sheet';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { fetchPlaceDetails, PlaceDetails } from '../../services/btcMapPlaces';
import {
  PlaceWithDistance,
  btcMapPlaceUrl,
  categoryInfo,
  directionsUrl,
  formatDistance,
  phoneUrl,
  websiteUrl,
} from '../../utils/btcMapPlaces';
import { CATEGORY_COLOR } from './categoryStyle';

interface Props {
  place: PlaceWithDistance | null;
  showDistance: boolean;
  onClose: () => void;
  onScanToPay: () => void;
}

export function PlaceDetailSheet({ place, showDistance, onClose, onScanToPay }: Props) {
  // Keep the last place while the sheet animates out.
  const [shown, setShown] = useState<PlaceWithDistance | null>(place);
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [detailsState, setDetailsState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (place) setShown(place);
  }, [place]);

  const id = place?.id;
  useEffect(() => {
    if (id == null) return;
    const controller = new AbortController();
    setDetails(null);
    setDetailsState('loading');
    fetchPlaceDetails(id, controller.signal)
      .then((d) => { setDetails(d); setDetailsState('idle'); })
      .catch(() => { if (!controller.signal.aborted) setDetailsState('error'); });
    return () => controller.abort();
  }, [id]);

  if (!shown) return null;
  const cat = categoryInfo(shown.category);
  const color = CATEGORY_COLOR[shown.category];
  const site = websiteUrl(shown.website);
  const tel = phoneUrl(shown.phone);
  const open = (url?: string) => { if (url) Linking.openURL(url).catch(() => {}); };
  const pay = details?.payments;

  const subtitle = [cat.label, showDistance ? `${formatDistance(shown.distanceM)} away` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet visible={!!place} onClose={onClose} title={shown.name} subtitle={subtitle} testID="place-detail-sheet">
      <View style={styles.body}>
        <View style={styles.badges}>
          <Badge label={cat.label} icon={cat.icon as any} color={color} />
          {detailsState === 'loading' && <Badge label="Checking payments…" tone="neutral" />}
          {pay?.onchain && <Badge label="On-chain" icon="logo-bitcoin" color={theme.colors.networks.onchain} />}
          {pay?.lightning && <Badge label="Lightning" icon="flash" color={theme.colors.networks.lightning} />}
          {pay?.contactless && <Badge label="Contactless" icon="wifi" color={theme.colors.info[500]} />}
          {!!shown.verifiedAt && (
            <Badge label={`Verified ${shown.verifiedAt.slice(0, 7)}`} icon="checkmark-circle" tone="success" />
          )}
        </View>

        {!!shown.address && <InfoLine icon="location-outline" text={shown.address} />}
        {!!shown.openingHours && <InfoLine icon="time-outline" text={shown.openingHours} />}
        {!!details?.description && <InfoLine icon="information-circle-outline" text={details.description} lines={4} />}

        <Button
          title="Directions"
          onPress={() => open(directionsUrl(shown, Platform.OS))}
          icon={<Ionicons name="navigate" size={18} color={theme.colors.text.inverse} />}
          fullWidth
          style={styles.primary}
        />
        <View style={styles.actions}>
          <Action icon="scan" label="Scan to pay" onPress={onScanToPay} />
          {tel && <Action icon="call" label="Call" onPress={() => open(tel)} />}
          {site && <Action icon="globe-outline" label="Website" onPress={() => open(site)} />}
          <Action icon="open-outline" label="BTC Map" onPress={() => open(btcMapPlaceUrl(shown))} />
        </View>
      </View>
    </Sheet>
  );
}

function InfoLine({ icon, text, lines = 2 }: { icon: string; text: string; lines?: number }) {
  return (
    <View style={styles.info}>
      <Ionicons name={icon as any} size={16} color={theme.colors.text.tertiary} />
      <Text style={styles.infoText} numberOfLines={lines}>{text}</Text>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon as any} size={18} color={theme.colors.primary[500]} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  body: { gap: theme.spacing[3], paddingBottom: theme.spacing[2] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[1.5] },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[2] },
  infoText: {
    flex: 1,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.snug),
  },
  primary: { marginTop: theme.spacing[1] },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: theme.spacing[1], minWidth: 64, paddingVertical: theme.spacing[1] },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.elevated,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
  },
  actionLabel: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
  },
});
