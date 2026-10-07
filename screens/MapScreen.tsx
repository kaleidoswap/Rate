// screens/MapScreen.tsx
//
// Places to pay with bitcoin: a map plus a nearest-first list, with search and
// category filters. Data comes from the BTC Map API (services/btcMapPlaces);
// the last result is cached so the screen opens instantly.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  LayoutAnimation,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { theme, leading } from '../theme';
import { EmptyState, MainHeader } from '../components';
import { Skeleton } from '../components/Skeleton';
import { PlacesMap, PlacesMapHandle, MapMarker } from '../components/map/PlacesMap';
import { CategoryChips } from '../components/map/CategoryChips';
import { PlaceRow, PLACE_ROW_HEIGHT } from '../components/map/PlaceRow';
import { PlaceDetailSheet } from '../components/map/PlaceDetailSheet';
import { CATEGORY_COLOR } from '../components/map/categoryStyle';
import {
  DEFAULT_RADIUS_KM,
  NearbyResult,
  cacheCovers,
  fetchNearbyPlaces,
  readCachedNearby,
} from '../services/btcMapPlaces';
import { geocodeAddress } from '../services/btcmapService';
import {
  CategoryFilter,
  Coords,
  PlaceWithDistance,
  countByCategory,
  distanceMeters,
  filterPlaces,
  sortByDistance,
  withDistance,
} from '../utils/btcMapPlaces';

interface Props {
  navigation: any;
}

/** Lugano — used until we know where the user is. */
const FALLBACK_COORDS: Coords = { lat: 46.00607, lng: 8.95201 };
const MAX_MARKERS = 400;
const SEARCH_DEBOUNCE_MS = 250;
/** How far the list panel's rounded top overlaps the map's bottom edge. */
const PANEL_OVERLAP = theme.spacing[3];

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type LoadStatus = 'booting' | 'loading' | 'ready' | 'error';

export default function MapScreen({ navigation }: Props) {
  const mapRef = useRef<PlacesMapHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<PlaceWithDistance>>(null);

  const [initialCenter, setInitialCenter] = useState<Coords | null>(null);
  const [data, setData] = useState<NearbyResult | null>(null);
  const dataRef = useRef<NearbyResult | null>(null);
  dataRef.current = data;
  const [status, setStatus] = useState<LoadStatus>('booting');
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [user, setUser] = useState<Coords | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [locating, setLocating] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingArea, setPendingArea] = useState<{ center: Coords; radiusKm: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const load = useCallback(async (center: Coords, radiusKm = DEFAULT_RADIUS_KM) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setRefreshFailed(false);
    setPendingArea(null);
    try {
      const result = await fetchNearbyPlaces(center, radiusKm, controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setStatus('ready');
    } catch {
      if (controller.signal.aborted) return;
      const hasData = !!dataRef.current;
      setStatus(hasData ? 'ready' : 'error');
      setRefreshFailed(hasData);
    }
  }, []);

  const locate = useCallback(async (): Promise<Coords | null> => {
    setLocating(true);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setPermission('denied');
        return null;
      }
      setPermission('granted');
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null);
      const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUser(c);
      return c;
    } catch {
      return null;
    } finally {
      setLocating(false);
    }
  }, []);

  // Boot: show the cached area at once, then move to the user's position.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCachedNearby();
      if (!alive) return;
      if (cached) {
        setData(cached);
        setStatus('ready');
      }
      setInitialCenter(cached?.center ?? FALLBACK_COORDS);
      const here = await locate();
      if (!alive) return;
      if (here) {
        mapRef.current?.flyTo(here, 14);
        if (!cacheCovers(cached, here)) load(here);
      } else if (!cached) {
        load(FALLBACK_COORDS);
      }
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [load, locate]);

  const origin = user ?? data?.center ?? null;

  const sorted = useMemo<PlaceWithDistance[]>(
    () => (data && origin ? sortByDistance(withDistance(data.places, origin)) : []),
    [data, origin],
  );
  const counts = useMemo(() => countByCategory(sorted, debouncedQuery), [sorted, debouncedQuery]);
  const visible = useMemo(
    () => filterPlaces(sorted, { category, query: debouncedQuery }),
    [sorted, category, debouncedQuery],
  );
  const markers = useMemo<MapMarker[]>(
    () => visible.slice(0, MAX_MARKERS).map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, color: CATEGORY_COLOR[p.category] })),
    [visible],
  );
  const selected = useMemo(() => sorted.find((p) => p.id === selectedId) ?? null, [sorted, selectedId]);

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => !e);
  }, []);

  const onSelectFromMap = useCallback((id: number | null) => {
    setSelectedId(id);
  }, []);

  const onSelectFromList = useCallback((id: number) => {
    Keyboard.dismiss();
    setSelectedId(id);
  }, []);

  const onMoved = useCallback((center: Coords, radiusKm: number) => {
    setPendingArea((prev) => {
      if (!data) return prev;
      const awayKm = distanceMeters(data.center, center) / 1000;
      const zoomedOut = radiusKm > data.radiusKm * 1.5;
      return awayKm > data.radiusKm / 3 || zoomedOut ? { center, radiusKm } : null;
    });
  }, [data]);

  const onLocate = useCallback(async () => {
    if (permission === 'denied') {
      Linking.openSettings().catch(() => {});
      return;
    }
    const here = await locate();
    if (here) {
      mapRef.current?.flyTo(here, 14);
      if (!cacheCovers(data, here)) load(here);
    }
  }, [permission, locate, data, load]);

  const searchAsPlace = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    Keyboard.dismiss();
    setGeocoding(true);
    try {
      const c = await geocodeAddress(q);
      if (c) {
        setQuery('');
        setCategory('all');
        mapRef.current?.flyTo(c, 13);
        if (expanded) toggleExpanded();
        await load(c);
      }
    } finally {
      setGeocoding(false);
    }
  }, [query, load, expanded, toggleExpanded]);

  const onScanToPay = useCallback(() => {
    setSelectedId(null);
    navigation.navigate('QRScanner', { mode: 'payment' });
  }, [navigation]);

  const showDistance = !!user;
  const busy = status === 'loading' || status === 'booting';
  const headline = busy && !data
    ? 'Finding places…'
    : `${visible.length} ${visible.length === 1 ? 'place' : 'places'}${user ? ' nearby' : ''}`;

  const renderItem = useCallback(
    ({ item }: { item: PlaceWithDistance }) => (
      <PlaceRow place={item} selected={item.id === selectedId} showDistance={showDistance} onPress={onSelectFromList} />
    ),
    [selectedId, showDistance, onSelectFromList],
  );

  const listEmpty = () => {
    if (busy && !data) {
      return (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={40} height={40} radius={theme.borderRadius.md} />
              <View style={styles.skeletonText}>
                <Skeleton width="60%" height={14} />
                <Skeleton width="40%" height={12} />
              </View>
            </View>
          ))}
        </View>
      );
    }
    if (status === 'error') {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load places"
          message="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => load(user ?? data?.center ?? initialCenter ?? FALLBACK_COORDS)}
        />
      );
    }
    if (debouncedQuery.trim().length >= 2) {
      return (
        <EmptyState
          icon="search-outline"
          title={`No places match “${debouncedQuery.trim()}”`}
          message="Try another name, or look up that city or address on the map."
          actionLabel={geocoding ? 'Searching…' : `Go to “${debouncedQuery.trim()}”`}
          onAction={searchAsPlace}
        />
      );
    }
    if (category !== 'all') {
      return (
        <EmptyState
          icon="filter-outline"
          title="Nothing in this category here"
          actionLabel="Show all places"
          onAction={() => setCategory('all')}
        />
      );
    }
    return (
      <EmptyState
        icon="map-outline"
        title="No places here yet"
        message="Move the map and search this area, or zoom out to look further."
      />
    );
  };

  return (
    <View style={styles.container}>
      <MainHeader
        title="Places to pay"
        onBack={() => navigation.goBack()}
        subtitle="Shops and venues that accept bitcoin"
        icon="map"
      />

      <View style={styles.controls}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={theme.colors.text.tertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search places or a city"
            placeholderTextColor={theme.colors.text.muted}
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={() => { if (visible.length === 0) searchAsPlace(); }}
            autoCorrect={false}
            accessibilityLabel="Search places"
          />
          {geocoding ? (
            <ActivityIndicator size="small" color={theme.colors.primary[500]} />
          ) : query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
        {expanded && <CategoryChips value={category} counts={counts} onChange={setCategory} />}
      </View>

      <View style={[styles.mapArea, expanded && styles.mapHidden]}>
        {initialCenter && !mapFailed && (
          <PlacesMap
            ref={mapRef}
            initialCenter={initialCenter}
            markers={markers}
            selectedId={selectedId}
            user={user}
            onSelect={onSelectFromMap}
            onMoved={onMoved}
            onError={() => setMapFailed(true)}
            bottomInset={PANEL_OVERLAP}
          />
        )}
        {mapFailed && (
          <View style={styles.mapFallback}>
            <Ionicons name="map-outline" size={28} color={theme.colors.text.tertiary} />
            <Text style={styles.mapFallbackText}>The map couldn't load. The list below still works.</Text>
          </View>
        )}

        {/* Overlays stack top-down so nothing covers anything else. */}
        <View style={styles.topOverlay} pointerEvents="box-none">
          <CategoryChips value={category} counts={counts} onChange={setCategory} floating />
          {permission === 'denied' && (
            <View style={styles.banner}>
              <Ionicons name="location-outline" size={16} color={theme.colors.warning[500]} />
              <Text style={styles.bannerText} numberOfLines={2}>
                Location is off. Turn it on to see places near you, or search a city.
              </Text>
              <TouchableOpacity onPress={() => Linking.openSettings()} hitSlop={8}>
                <Text style={styles.bannerAction}>Settings</Text>
              </TouchableOpacity>
            </View>
          )}
          {pendingArea && (
            <TouchableOpacity
              style={styles.areaPill}
              onPress={() => load(pendingArea.center, Math.max(DEFAULT_RADIUS_KM / 2, pendingArea.radiusKm))}
              accessibilityRole="button"
            >
              <Ionicons name="refresh" size={14} color={theme.colors.text.inverse} />
              <Text style={styles.areaPillText}>Search this area</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.locateFab}
          onPress={onLocate}
          accessibilityRole="button"
          accessibilityLabel="Show my location"
        >
          {locating ? (
            <ActivityIndicator size="small" color={theme.colors.primary[500]} />
          ) : (
            <Ionicons name={user ? 'locate' : 'locate-outline'} size={20} color={theme.colors.primary[500]} />
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.panel, expanded && styles.panelExpanded]}>
        <TouchableOpacity style={styles.panelHeader} onPress={toggleExpanded} accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show map' : 'Show full list'}>
          <View style={styles.handle} />
          <View style={styles.panelTitleRow}>
            <Text style={styles.panelTitle}>{headline}</Text>
            {status === 'loading' && !!data && <ActivityIndicator size="small" color={theme.colors.primary[500]} />}
            <View style={styles.fill} />
            <View style={styles.toggle}>
              <Ionicons name={expanded ? 'map-outline' : 'list'} size={14} color={theme.colors.text.secondary} />
              <Text style={styles.toggleText}>{expanded ? 'Map' : 'List'}</Text>
            </View>
          </View>
          {refreshFailed && (
            <Text style={styles.staleNote}>Couldn't refresh. Showing saved places.</Text>
          )}
        </TouchableOpacity>

        <FlatList
          ref={listRef}
          data={visible}
          keyExtractor={(p) => String(p.id)}
          renderItem={renderItem}
          ListEmptyComponent={listEmpty}
          getItemLayout={(_, index) => ({ length: PLACE_ROW_HEIGHT, offset: PLACE_ROW_HEIGHT * index, index })}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={visible.length === 0 ? styles.fill : styles.listContent}
        />
        <Text style={styles.attribution}>Data: BTC Map · OpenStreetMap contributors</Text>
      </View>

      <PlaceDetailSheet
        place={selected}
        showDistance={showDistance}
        onClose={() => setSelectedId(null)}
        onScanToPay={onScanToPay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  fill: { flex: 1 },

  controls: {
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    backgroundColor: theme.colors.background.primary,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginHorizontal: theme.spacing[4],
    paddingHorizontal: theme.spacing[3.5],
    height: 44,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    paddingVertical: 0,
  },

  mapArea: { flex: 1, overflow: 'hidden', backgroundColor: theme.colors.background.primary },
  mapHidden: { flex: 0, height: 0 },
  mapFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  mapFallbackText: {
    color: theme.colors.text.tertiary,
    fontSize: theme.typography.fontSize.sm,
    textAlign: 'center',
  },
  topOverlay: {
    position: 'absolute',
    top: theme.spacing[2],
    left: 0,
    right: 0,
    gap: theme.spacing[2],
  },
  banner: {
    marginHorizontal: theme.spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2.5],
    paddingVertical: theme.spacing[2.5],
    paddingHorizontal: theme.spacing[3.5],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.medium,
    ...theme.shadows.md,
  },
  bannerText: {
    flex: 1,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.tight),
  },
  bannerAction: {
    color: theme.colors.primary[500],
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.bold,
  },
  areaPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary[500],
    ...theme.shadows.md,
  },
  areaPillText: {
    color: theme.colors.text.inverse,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.bold,
  },
  locateFab: {
    position: 'absolute',
    right: theme.spacing[3],
    bottom: PANEL_OVERLAP + theme.spacing[3],
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.elevated,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    ...theme.shadows.md,
  },

  panel: {
    flex: 0.85,
    marginTop: -PANEL_OVERLAP,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.medium,
    overflow: 'hidden',
    ...theme.shadows.lg,
  },
  panelExpanded: { flex: 1, marginTop: 0 },
  panelHeader: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.dark,
    marginBottom: theme.spacing[2],
  },
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  panelTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.bold,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2.5],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.elevated,
  },
  toggleText: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  staleNote: {
    marginTop: theme.spacing[1],
    color: theme.colors.warning[500],
    fontSize: theme.typography.fontSize.xs,
  },
  listContent: { paddingBottom: theme.spacing[2] },
  attribution: {
    textAlign: 'center',
    paddingVertical: theme.spacing[1.5],
    color: theme.colors.text.muted,
    fontSize: 10,
  },

  skeletons: { paddingTop: theme.spacing[2] },
  skeletonRow: {
    height: PLACE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  skeletonText: { flex: 1, gap: theme.spacing[1.5] },
});
