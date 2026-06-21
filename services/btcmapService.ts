// services/btcmapService.ts
//
// Live "Bitcoin merchants near me" lookups. The previous merchant finder was
// hardcoded to a static Lugano JSON dump, so it always reported Lugano venues
// regardless of where the user actually is. This service replaces that with:
//
//   1. the device's real GPS location (expo-location), and
//   2. live merchant data from the BTC Map dataset.
//
// BTC Map merchants are OpenStreetMap elements tagged `currency:XBT=yes`
// (plus `payment:lightning` / `payment:onchain`). BTC Map's own REST API
// (`/v4/places`) is a chronological *sync* feed with no geo filter, and its
// RPC `search` is text-only — neither can answer "near this coordinate". So we
// query the same upstream OSM data by radius through Overpass, which natively
// supports `around:`. Same dataset BTC Map shows, just filtered by distance.

import * as Location from 'expo-location';
import { Directory, File, Paths } from 'expo-file-system';

/** KaleidoSwap home base (Lugano) — only used when we can't get a real fix. */
export const FALLBACK_COORDS: Coords = { lat: 46.00607, lng: 8.95201 };

// BTC Map's own element dump. A single reliable GET (CDN-backed), filtered
// client-side by distance — the same approach kaleido-mind's host adapter uses.
// We previously POST'd live Overpass queries, which are rate-limited and flaky
// from a device, so they frequently threw and dropped us to the offline list.
const BTCMAP_ELEMENTS_URL = 'https://api.btcmap.org/v2/elements';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // BTC Map data changes slowly — cache a day.

const DEFAULT_RADIUS_M = 5000; // 5 km — a sensible "near me" walking/transit radius
const MAX_RADIUS_M = 50000;
const REQUEST_TIMEOUT_MS = 20000;

export interface Coords {
  lat: number;
  lng: number;
}

export interface BtcMapMerchant {
  id: number;
  osm_type: 'node' | 'way' | 'relation';
  name: string;
  address?: string;
  category: string; // friendly category label (restaurant, cafe, bar, shop, …)
  icon: string; // emoji for the category
  lat: number;
  lon: number;
  distance_m: number;
  phone?: string;
  website?: string;
  opening_hours?: string;
  accepts_lightning: boolean;
  accepts_onchain: boolean;
}

export interface UserLocation {
  coords: Coords;
  /** true when we used the device GPS, false when we fell back to Lugano. */
  precise: boolean;
  label?: string; // reverse-geocoded "City, Region" when available
}

/**
 * Resolve where the user actually is. Asks for foreground location permission,
 * reads one balanced-accuracy fix, and (best-effort) reverse-geocodes it to a
 * human label. Falls back to Lugano if permission is denied or the fix fails so
 * callers always get usable coordinates.
 */
export async function getUserLocation(): Promise<UserLocation> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { coords: FALLBACK_COORDS, precise: false };
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const coords: Coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };

    let label: string | undefined;
    try {
      const [place] = await Location.reverseGeocodeAsync({
        latitude: coords.lat,
        longitude: coords.lng,
      });
      if (place) {
        label = [place.city ?? place.subregion, place.region]
          .filter(Boolean)
          .join(', ') || undefined;
      }
    } catch {
      // reverse-geocode is a nicety, not required
    }

    return { coords, precise: true, label };
  } catch (err) {
    console.warn('📍 getUserLocation failed, using fallback:', err);
    return { coords: FALLBACK_COORDS, precise: false };
  }
}

/** Geocode a free-text address (for the `near_address` path). */
/**
 * Geocode a free-text place ("Turin", "Torino, Italy") to coordinates.
 *
 * Primary path is a network geocoder (Nominatim/OSM) — the same dataset the
 * merchants come from, and it works regardless of device location permission or
 * platform geocoder availability. The OS geocoder (`Location.geocodeAsync`) is
 * only a secondary fallback: it is flaky for remote cities (often empty on
 * Android) and unavailable in the hands-free worker path, which is why a spoken
 * "merchants in Turin" used to fail. Net: city lookups no longer need the
 * device's position at all.
 */
export async function geocodeAddress(address: string): Promise<Coords | null> {
  const q = address.trim();
  if (!q) return null;

  const fromNominatim = await geocodeViaNominatim(q);
  if (fromNominatim) return fromNominatim;

  try {
    const [hit] = await Location.geocodeAsync(q);
    if (hit) return { lat: hit.latitude, lng: hit.longitude };
  } catch (err) {
    console.warn('📍 OS geocoder failed:', err);
  }
  return null;
}

async function geocodeViaNominatim(query: string): Promise<Coords | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(query);
    const res = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires an identifying User-Agent.
        'User-Agent': 'KaleidoSwap-Wallet/1.0 (merchant-search)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = arr?.[0];
    if (!hit?.lat || !hit?.lon) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  } catch (err) {
    clearTimeout(timer);
    console.warn('📍 Nominatim geocode failed:', err);
    return null;
  }
}

// Haversine distance in metres.
export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// Map an OSM element's tags to a friendly category + emoji.
function classify(tags: Record<string, string>): { category: string; icon: string } {
  const shop = tags.shop;
  const amenity = tags.amenity;
  const tourism = tags.tourism;

  if (amenity === 'restaurant' || amenity === 'fast_food') return { category: 'restaurant', icon: '🍽️' };
  if (amenity === 'cafe' || shop === 'coffee') return { category: 'cafe', icon: '☕' };
  if (amenity === 'bar' || amenity === 'pub' || amenity === 'biergarten') return { category: 'bar', icon: '🍺' };
  if (amenity === 'bank' || amenity === 'bureau_de_change' || tags['currency:XBT'] === 'yes' && amenity === 'atm') return { category: 'finance', icon: '🏦' };
  if (amenity === 'atm') return { category: 'atm', icon: '🏧' };
  if (tourism === 'hotel' || tourism === 'guest_house' || tourism === 'hostel' || tourism === 'apartment') return { category: 'lodging', icon: '🏨' };
  if (tourism === 'attraction' || tourism === 'museum') return { category: 'attraction', icon: '🎟️' };
  if (shop === 'supermarket' || shop === 'convenience' || shop === 'grocery') return { category: 'grocery', icon: '🛒' };
  if (shop === 'hairdresser' || shop === 'beauty') return { category: 'beauty', icon: '💈' };
  if (amenity === 'pharmacy' || shop === 'chemist') return { category: 'pharmacy', icon: '💊' };
  if (shop) return { category: 'shop', icon: '🛍️' };
  if (amenity) return { category: amenity, icon: '📍' };
  return { category: 'merchant', icon: '📍' };
}

function buildAddress(tags: Record<string, string>): string | undefined {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const parts = [street, tags['addr:postcode'], tags['addr:city']].filter(Boolean);
  const addr = parts.join(', ').trim();
  return addr.length > 0 ? addr : undefined;
}

/** Subset of the BTC Map v2 element schema we consume. */
interface BtcMapElement {
  id: string;
  osm_json?: {
    type?: 'node' | 'way' | 'relation';
    id?: number;
    lat?: number;
    lon?: number;
    bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
    tags?: Record<string, string>;
  };
  deleted_at?: string;
}

interface ElementsCache {
  fetchedAt: number;
  elements: BtcMapElement[];
}

// In-memory cache for the session; the disk cache survives restarts (24h TTL).
let memElements: BtcMapElement[] | null = null;
let memElementsAt = 0;

function cacheFile(): File {
  const dir = new Directory(Paths.cache, 'kaleido');
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, 'btcmap-elements.json');
}

/**
 * Load the BTC Map element dump — from memory, then disk (if < 24h old), then a
 * live fetch. Throws only when there is no usable cache AND the network fetch
 * fails, so callers can fall back gracefully.
 */
async function loadElements(): Promise<BtcMapElement[]> {
  if (memElements && Date.now() - memElementsAt < CACHE_TTL_MS) return memElements;

  const file = cacheFile();
  try {
    if (file.exists) {
      const cached = JSON.parse(file.textSync()) as ElementsCache;
      if (cached && Array.isArray(cached.elements) && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        memElements = cached.elements;
        memElementsAt = cached.fetchedAt;
        return cached.elements;
      }
    }
  } catch {
    // corrupt cache — ignore and refetch
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 2);
  let live: BtcMapElement[];
  try {
    const res = await fetch(BTCMAP_ELEMENTS_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`BTC Map → HTTP ${res.status}`);
    const data = (await res.json()) as BtcMapElement[];
    live = data.filter((e) => !e.deleted_at);
  } catch (err) {
    clearTimeout(timer);
    // Stale-but-present cache beats a hard failure — serve it if we have one.
    if (memElements) return memElements;
    try {
      if (file.exists) {
        const stale = JSON.parse(file.textSync()) as ElementsCache;
        if (stale && Array.isArray(stale.elements)) return stale.elements;
      }
    } catch {
      /* no usable fallback */
    }
    throw err;
  }

  memElements = live;
  memElementsAt = Date.now();
  try {
    file.write(JSON.stringify({ fetchedAt: memElementsAt, elements: live }));
  } catch {
    // disk cache is best-effort
  }
  return live;
}

/** A point for an element — its own lat/lon, or the centre of its bbox. */
function elementCenter(el: BtcMapElement): Coords | null {
  const j = el.osm_json;
  if (!j) return null;
  if (j.lat != null && j.lon != null) return { lat: j.lat, lng: j.lon };
  if (j.bounds) {
    return {
      lat: (j.bounds.minlat + j.bounds.maxlat) / 2,
      lng: (j.bounds.minlon + j.bounds.maxlon) / 2,
    };
  }
  return null;
}

export interface FindNearbyParams {
  center: Coords;
  radiusMeters?: number;
  /** Optional free-text filter applied to name/category after the geo query. */
  query?: string;
  /** Optional category filter (e.g. "restaurant", "cafe", "bar", "shop"). */
  category?: string;
  limit?: number;
}

/**
 * Find Bitcoin-accepting merchants near `center` from the BTC Map dataset,
 * sorted nearest-first. Throws if the element dump can't be loaded (no cache +
 * network failure) — callers should catch and fall back for graceful degradation.
 */
export async function findNearbyMerchants({
  center,
  radiusMeters = DEFAULT_RADIUS_M,
  query,
  category,
  limit = 10,
}: FindNearbyParams): Promise<BtcMapMerchant[]> {
  const radius = Math.max(250, Math.min(MAX_RADIUS_M, Math.round(radiusMeters)));

  const elements = await loadElements();

  const merchants: BtcMapMerchant[] = elements
    .map((el) => {
      const point = elementCenter(el);
      const tags = el.osm_json?.tags ?? {};
      if (!point || !tags.name) return null;

      const distance = distanceMeters(center, point);
      if (distance > radius) return null;

      const { category: cat, icon } = classify(tags);
      const acceptsLn =
        tags['payment:lightning'] === 'yes' || tags['payment:lightning_contactless'] === 'yes';
      const acceptsOnchain =
        tags['payment:onchain'] === 'yes' ||
        tags['payment:bitcoin'] === 'yes' ||
        tags['currency:XBT'] === 'yes';

      return {
        id: el.osm_json?.id ?? 0,
        osm_type: el.osm_json?.type ?? 'node',
        name: tags.name,
        address: buildAddress(tags),
        category: cat,
        icon,
        lat: point.lat,
        lon: point.lng,
        distance_m: distance,
        phone: tags.phone ?? tags['contact:phone'],
        website: tags.website ?? tags['contact:website'],
        opening_hours: tags.opening_hours,
        accepts_lightning: acceptsLn,
        accepts_onchain: acceptsOnchain || acceptsLn,
      } as BtcMapMerchant;
    })
    .filter((m): m is BtcMapMerchant => m !== null);

  let filtered = merchants;

  if (category) {
    const c = category.toLowerCase();
    filtered = filtered.filter(
      (m) => m.category.toLowerCase().includes(c) || c.includes(m.category.toLowerCase())
    );
  }

  if (query && query.trim().length >= 2) {
    const q = query.toLowerCase().trim();
    filtered = filtered.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        (m.address?.toLowerCase().includes(q) ?? false)
    );
  }

  filtered.sort((a, b) => a.distance_m - b.distance_m);
  return filtered.slice(0, Math.max(1, Math.min(20, limit)));
}

/** Human-friendly distance, e.g. "320 m" or "2.4 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}
