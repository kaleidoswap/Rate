// screens/MapScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { theme, leading } from '../theme';
import { MainHeader } from '../components';
import { BrandMark } from '../components/BrandMark';

interface Props {
  navigation: any;
}

type Coords = { lat: number; lng: number };

/** KaleidoSwap home base (Lugano) — used until we know where the user is. */
const FALLBACK_COORDS: Coords = { lat: 46.00607, lng: 8.95201 };
const DEFAULT_ZOOM = 15;

const buildMapUrl = ({ lat, lng }: Coords, zoom = DEFAULT_ZOOM) =>
  `https://btcmap.org/map#${zoom}/${lat.toFixed(5)}/${lng.toFixed(5)}`;

// Injected into btcmap.org to pull its Leaflet chrome onto the KaleidoSwap
// palette: dark surfaces, brand-green controls and links. Additive only — it
// restyles, it never removes map functionality. Re-applied on a short delay so
// it also catches controls the SPA mounts after first paint.
const BRAND_MAP_CSS = `
  :root { color-scheme: dark; }
  .leaflet-bar a,
  .leaflet-control-zoom a,
  .leaflet-control-locate a {
    background-color: #121C16 !important;
    color: #2BEE79 !important;
    border-color: rgba(255,255,255,0.10) !important;
  }
  .leaflet-bar a:hover,
  .leaflet-control-zoom a:hover,
  .leaflet-control-locate a:hover { background-color: #1B2C21 !important; }
  .leaflet-bar { border-radius: 12px !important; overflow: hidden; box-shadow: 0 6px 18px rgba(0,0,0,0.45) !important; }
  .leaflet-control-attribution {
    background: rgba(13,24,19,0.82) !important;
    color: rgba(255,255,255,0.5) !important;
    border-radius: 8px 0 0 0 !important;
  }
  .leaflet-control-attribution a { color: #2BEE79 !important; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: rgba(43,238,121,0.4); border-radius: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
`;

const INJECTED_BRANDING = `
  (function () {
    function apply() {
      try {
        var id = 'kaleido-map-brand';
        if (document.getElementById(id)) return;
        var s = document.createElement('style');
        s.id = id;
        s.textContent = ${JSON.stringify(BRAND_MAP_CSS)};
        document.head.appendChild(s);
      } catch (e) {}
    }
    apply();
    setTimeout(apply, 600);
    setTimeout(apply, 1800);
  })();
  true;
`;

export default function MapScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);

  const [coords, setCoords] = useState<Coords>(FALLBACK_COORDS);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [locating, setLocating] = useState(true);
  const [webLoading, setWebLoading] = useState(true);
  // Bumping this remounts the WebView so it recenters on fresh coordinates.
  const [reloadToken, setReloadToken] = useState(0);

  const fetchLocation = useCallback(async (recenter = false) => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (recenter) setReloadToken((t) => t + 1);
    } catch {
      // Network/GPS hiccup — quietly keep whatever center we already have.
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  const mapUrl = useMemo(() => buildMapUrl(coords), [coords]);

  const onLocatePress = useCallback(() => {
    if (permission === 'denied') {
      Linking.openSettings();
      return;
    }
    fetchLocation(true);
  }, [permission, fetchLocation]);

  const busy = locating || webLoading;

  return (
    <View style={styles.container}>
      <MainHeader
        title="Bitcoin Map"
        subtitle="Discover Bitcoin-accepting venues near you"
        icon="map"
      />

      <View style={styles.mapContainer}>
        <WebView
          key={reloadToken}
          ref={webRef}
          source={{ uri: mapUrl }}
          style={styles.webview}
          injectedJavaScript={INJECTED_BRANDING}
          onLoadStart={() => setWebLoading(true)}
          onLoadEnd={() => setWebLoading(false)}
          startInLoadingState={false}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={Platform.OS === 'ios'}
          allowsFullscreenVideo
          scrollEnabled
          bounces={false}
        />

        {/* Permission-denied hint — non-blocking, sits above the fallback map. */}
        {permission === 'denied' && (
          <View style={[styles.banner, { top: theme.spacing[3] }]}>
            <Ionicons name="location-outline" size={16} color={theme.colors.warning[500]} />
            <Text style={styles.bannerText} numberOfLines={2}>
              Location is off — showing the default area. Enable it to find venues around you.
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()} hitSlop={8}>
              <Text style={styles.bannerAction}>Enable</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Attribution chip */}
        <View style={[styles.attribution, { bottom: insets.bottom + theme.spacing[4] }]}>
          <View style={styles.attrDot} />
          <Text style={styles.attrText}>Powered by BTC Map</Text>
        </View>

        {/* Locate-me FAB */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onLocatePress}
          style={[styles.fab, { bottom: insets.bottom + theme.spacing[4] }]}
          accessibilityLabel="Center map on my location"
        >
          <LinearGradient
            colors={['#3BFF8C', '#15E99A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabInner}
          >
            {locating ? (
              <ActivityIndicator size="small" color={theme.colors.primary[950]} />
            ) : (
              <Ionicons
                name={permission === 'denied' ? 'location-outline' : 'locate'}
                size={22}
                color={theme.colors.primary[950]}
              />
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Branded loading veil while we locate the user / boot the map. */}
        {busy && (
          <LinearGradient
            colors={['#0B2416', '#08200F', '#05160D']}
            style={styles.loadingVeil}
            pointerEvents="none"
          >
            <View style={styles.loadingMark}>
              <BrandMark size={64} />
            </View>
            <ActivityIndicator color={theme.colors.primary[500]} style={{ marginTop: theme.spacing[5] }} />
            <Text style={styles.loadingText}>
              {locating ? 'Finding venues near you…' : 'Loading the map…'}
            </Text>
          </LinearGradient>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  mapContainer: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  webview: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },

  banner: {
    position: 'absolute',
    left: theme.spacing[3],
    right: theme.spacing[3],
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

  attribution: {
    position: 'absolute',
    left: theme.spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: 'rgba(13, 24, 19, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  attrDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary[500],
  },
  attrText: {
    color: theme.colors.text.tertiary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    letterSpacing: 0.2,
  },

  fab: {
    position: 'absolute',
    right: theme.spacing[4],
    width: 54,
    height: 54,
    borderRadius: 27,
    ...theme.shadows.lg,
    shadowColor: theme.colors.primary[500],
    shadowOpacity: 0.45,
  },
  fabInner: {
    flex: 1,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
  },

  loadingVeil: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingMark: {
    opacity: 0.95,
  },
  loadingText: {
    marginTop: theme.spacing[4],
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
  },
});
