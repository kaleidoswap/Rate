// components/map/PlaceRow.tsx
import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { PlaceWithDistance, categoryInfo, formatDistance } from '../../utils/btcMapPlaces';
import { CATEGORY_COLOR } from './categoryStyle';

interface Props {
  place: PlaceWithDistance;
  selected?: boolean;
  /** Distance is hidden when we don't know where the user is. */
  showDistance: boolean;
  onPress: (id: number) => void;
}

export const PLACE_ROW_HEIGHT = 72;

export const PlaceRow = memo(function PlaceRow({ place, selected, showDistance, onPress }: Props) {
  const cat = categoryInfo(place.category);
  const color = CATEGORY_COLOR[place.category];
  return (
    <TouchableOpacity
      style={[styles.row, selected && styles.selected]}
      onPress={() => onPress(place.id)}
      accessibilityRole="button"
      accessibilityLabel={`${place.name}, ${cat.label}${showDistance ? `, ${formatDistance(place.distanceM)} away` : ''}`}
    >
      <View style={[styles.icon, { backgroundColor: color + '24' }]}>
        <Ionicons name={cat.icon as any} size={18} color={color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {cat.label}
          {place.address ? ` · ${place.address}` : ''}
        </Text>
      </View>
      {showDistance && <Text style={styles.distance}>{formatDistance(place.distanceM)}</Text>}
      <Ionicons name="chevron-forward" size={16} color={theme.colors.text.muted} />
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  row: {
    height: PLACE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  selected: { backgroundColor: theme.colors.surface.elevated },
  icon: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  name: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  meta: {
    marginTop: 2,
    color: theme.colors.text.tertiary,
    fontSize: theme.typography.fontSize.xs,
  },
  distance: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
});
