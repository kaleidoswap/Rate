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

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const DEFAULT_RADIUS_M = 5000; // 5 km — a sensible "near me" walking/transit radius
const MAX_RADIUS_M = 50000;
const REQUEST_TIMEOUT_MS = 20000;
const LOCATION_TIMEOUT_MS = 12000;
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

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
  /** true when coordinates came from the device location provider. */
  precise: boolean;
  label?: string; // reverse-geocoded "City, Region" when available
}

function permissionGranted(status: Location.PermissionStatus | string | undefined): boolean {
  return status === Location.PermissionStatus.GRANTED || status === 'granted';
}

async function reverseGeocodeLabel(coords: Coords): Promise<string | undefined> {
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude: coords.lat,
      longitude: coords.lng,
    });
    if (!place) return undefined;
    return [place.city ?? place.subregion, place.region].filter(Boolean).join(', ') || undefined;
  } catch {
    // reverse-geocode is a nicety, not required
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function toCoords(position: Location.LocationObject): Coords {
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

/**
 * Resolve where the user actually is. Asks for foreground location permission,
 * reads one balanced-accuracy fix, and (best-effort) reverse-geocodes it to a
 * human label. Throws when the real device location is unavailable.
 */
export async function getUserLocation(): Promise<UserLocation> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permissionGranted(permission.status) && permission.canAskAgain !== false) {
      permission = await Location.requestForegroundPermissionsAsync();
    }

    if (!permissionGranted(permission.status)) {
      throw new Error(`Location permission ${permission.status}`);
    }

    const lastKnown = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
      requiredAccuracy: 5000,
    });
    if (lastKnown) {
      const coords = toCoords(lastKnown);
      return { coords, precise: true, label: await reverseGeocodeLabel(coords) };
    }

    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      LOCATION_TIMEOUT_MS,
      'Location lookup',
    );
    const coords = toCoords(pos);

    return { coords, precise: true, label: await reverseGeocodeLabel(coords) };
  } catch (err) {
    console.warn('[btcmap] getUserLocation failed:', err);
    throw err instanceof Error ? err : new Error('Location lookup failed');
  }
}

/** Geocode a free-text address (for the `near_address` path). */
export async function geocodeAddress(address: string): Promise<Coords | null> {
  try {
    const [hit] = await Location.geocodeAsync(address);
    if (!hit) return null;
    return { lat: hit.latitude, lng: hit.longitude };
  } catch (err) {
    console.warn('[btcmap] geocodeAddress failed:', err);
    return null;
  }
}

// Haversine distance in metres.
function distanceMeters(a: Coords, b: Coords): number {
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

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function runOverpass(query: string): Promise<OverpassElement[]> {
  let lastErr: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`Overpass ${endpoint} → HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      return (json.elements ?? []) as OverpassElement[];
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // try the next mirror
    }
  }
  throw lastErr ?? new Error('All Overpass endpoints failed');
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
 * Find Bitcoin-accepting merchants near `center` from the BTC Map (OSM) dataset,
 * sorted nearest-first. Throws if every Overpass mirror is unreachable.
 */
export async function findNearbyMerchants({
  center,
  radiusMeters = DEFAULT_RADIUS_M,
  query,
  category,
  limit = 10,
}: FindNearbyParams): Promise<BtcMapMerchant[]> {
  const radius = Math.max(250, Math.min(MAX_RADIUS_M, Math.round(radiusMeters)));
  const lat = center.lat;
  const lon = center.lng;

  // Union of the BTC Map payment tags, named elements only, with way/relation
  // centroids so non-point venues still get coordinates.
  const overpassQuery = `[out:json][timeout:25];
(
  nwr["currency:XBT"="yes"]["name"](around:${radius},${lat},${lon});
  nwr["payment:lightning"="yes"]["name"](around:${radius},${lat},${lon});
  nwr["payment:onchain"="yes"]["name"](around:${radius},${lat},${lon});
);
out center tags 200;`;

  const elements = await runOverpass(overpassQuery);

  const merchants: BtcMapMerchant[] = elements
    .map((el) => {
      const elat = el.lat ?? el.center?.lat;
      const elon = el.lon ?? el.center?.lon;
      const tags = el.tags ?? {};
      if (elat == null || elon == null || !tags.name) return null;

      const { category: cat, icon } = classify(tags);
      const acceptsLn =
        tags['payment:lightning'] === 'yes' || tags['payment:lightning_contactless'] === 'yes';
      const acceptsOnchain =
        tags['payment:onchain'] === 'yes' || tags['currency:XBT'] === 'yes';

      return {
        id: el.id,
        osm_type: el.type,
        name: tags.name,
        address: buildAddress(tags),
        category: cat,
        icon,
        lat: elat,
        lon: elon,
        distance_m: distanceMeters(center, { lat: elat, lng: elon }),
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
