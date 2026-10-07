// services/btcMapPlaces.ts
//
// Places that accept bitcoin, from the BTC Map v4 API:
//   GET /v4/places/search/?lat=&lon=&radius_km=   nearby places (small payload)
//   GET /v4/places/{id}?fields=…                   one place's OSM payment tags
// The last nearby result is kept in AsyncStorage so the map opens instantly.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Coords,
  Place,
  PaymentMethods,
  distanceMeters,
  normalizePlaces,
  paymentMethodsFromTags,
} from '../utils/btcMapPlaces';

const API = 'https://api.btcmap.org/v4/places';
const CACHE_KEY = 'btcmap.nearby.v1';
const REQUEST_TIMEOUT_MS = 15000;
/** Cached places are served instantly; refetched in the background when older. */
export const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 50;

export interface NearbyResult {
  center: Coords;
  radiusKm: number;
  fetchedAt: number;
  places: Place[];
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`BTC Map returned HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export async function readCachedNearby(): Promise<NearbyResult | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NearbyResult;
    if (!parsed?.center || !Array.isArray(parsed.places)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when `cache` already covers `center` well enough and is still fresh. */
export function cacheCovers(cache: NearbyResult | null, center: Coords, now = Date.now()): boolean {
  if (!cache) return false;
  if (now - cache.fetchedAt > CACHE_FRESH_MS) return false;
  return distanceMeters(cache.center, center) / 1000 <= cache.radiusKm / 4;
}

export async function fetchNearbyPlaces(
  center: Coords,
  radiusKm = DEFAULT_RADIUS_KM,
  signal?: AbortSignal,
): Promise<NearbyResult> {
  const r = Math.max(0.5, Math.min(MAX_RADIUS_KM, radiusKm));
  const url =
    `${API}/search/?lat=${center.lat.toFixed(5)}&lon=${center.lng.toFixed(5)}` +
    `&radius_km=${r.toFixed(1)}`;
  const data = await getJson(url, signal);
  const result: NearbyResult = { center, radiusKm: r, fetchedAt: Date.now(), places: normalizePlaces(data) };
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(result)).catch(() => {});
  return result;
}

export interface PlaceDetails {
  payments: PaymentMethods;
  description?: string;
}

const detailsCache = new Map<number, PlaceDetails>();

/** Payment methods (and description) for one place. Cached for the session. */
export async function fetchPlaceDetails(id: number, signal?: AbortSignal): Promise<PlaceDetails> {
  const hit = detailsCache.get(id);
  if (hit) return hit;
  const fields = [
    'id',
    'description',
    'osm:payment:onchain',
    'osm:payment:lightning',
    'osm:payment:lightning_contactless',
    'osm:payment:bitcoin',
  ].join(',');
  const data = (await getJson(`${API}/${id}?fields=${fields}`, signal)) as Record<string, unknown>;
  const description = typeof data?.description === 'string' && data.description.trim()
    ? data.description.trim()
    : undefined;
  const details: PlaceDetails = { payments: paymentMethodsFromTags(data), description };
  detailsCache.set(id, details);
  return details;
}
