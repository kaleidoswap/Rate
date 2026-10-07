const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  },
}));

import { cacheCovers, fetchNearbyPlaces, fetchPlaceDetails, readCachedNearby, CACHE_FRESH_MS } from './btcMapPlaces';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('btcMapPlaces service', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('fetches nearby places, normalises them and caches the result', async () => {
    const fetchMock = jest.fn(async () => okJson([
      { id: 5, lat: 46.0047, lon: 8.9528, name: 'La Dispensa', icon: 'local_bar' },
      { id: 6, lat: 46.0, lon: 8.9, name: '' },
    ]));
    global.fetch = fetchMock as any;

    const res = await fetchNearbyPlaces({ lat: 46.00607, lng: 8.95201 }, 3);
    expect((fetchMock.mock.calls[0] as any[])[0]).toBe(
      'https://api.btcmap.org/v4/places/search/?lat=46.00607&lon=8.95201&radius_km=3.0',
    );
    expect(res.places).toHaveLength(1);
    expect(res.places[0].category).toBe('food');
    await new Promise((r) => setImmediate(r));
    const cached = await readCachedNearby();
    expect(cached?.places[0].name).toBe('La Dispensa');
  });

  it('clamps the radius and surfaces HTTP errors', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as any;
    await expect(fetchNearbyPlaces({ lat: 0, lng: 0 }, 500)).rejects.toThrow('HTTP 503');
    expect(((global.fetch as jest.Mock).mock.calls[0] as any[])[0]).toContain('radius_km=50.0');
  });

  it('reads payment methods for one place', async () => {
    global.fetch = jest.fn(async () => okJson({
      id: 2, description: ' Boats ', 'osm:payment:lightning': 'yes', 'osm:payment:onchain': 'no',
    })) as any;
    const d = await fetchPlaceDetails(2);
    expect(d).toEqual({ payments: { onchain: false, lightning: true, contactless: false }, description: 'Boats' });
    // second call comes from the session cache
    await fetchPlaceDetails(2);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cacheCovers checks freshness and distance', () => {
    const now = 1_000_000_000;
    const cache = { center: { lat: 46, lng: 9 }, radiusKm: 5, fetchedAt: now, places: [] };
    expect(cacheCovers(null, { lat: 46, lng: 9 }, now)).toBe(false);
    expect(cacheCovers(cache, { lat: 46.005, lng: 9 }, now)).toBe(true);
    expect(cacheCovers(cache, { lat: 46.1, lng: 9 }, now)).toBe(false);
    expect(cacheCovers(cache, { lat: 46, lng: 9 }, now + CACHE_FRESH_MS + 1)).toBe(false);
  });
});
