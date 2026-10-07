import {
  PLACE_CATEGORIES,
  Place,
  btcMapPlaceUrl,
  categorize,
  categoryFromIcon,
  categoryFromTags,
  countByCategory,
  directionsUrl,
  distanceMeters,
  filterPlaces,
  foldText,
  formatDistance,
  normalizePlace,
  normalizePlaces,
  paymentMethodsFromTags,
  phoneUrl,
  sortByDistance,
  websiteUrl,
  withDistance,
} from './btcMapPlaces';

const place = (over: Partial<Place>): Place => ({
  id: 1, name: 'Place', lat: 46, lon: 9, category: 'other', ...over,
});

describe('categoryFromIcon', () => {
  it.each([
    ['restaurant', 'food'], ['local_pizza', 'food'], ['local_bar', 'food'],
    ['local_cafe', 'cafe'], ['bakery_dining', 'cafe'],
    ['local_grocery_store', 'groceries'],
    ['storefront', 'shops'], ['diamond', 'shops'],
    ['hotel', 'lodging'],
    ['currency_exchange', 'atm'], ['currency_bitcoin', 'atm'],
    ['content_cut', 'services'], ['local_pharmacy', 'services'],
  ])('%s -> %s', (icon, cat) => {
    expect(categoryFromIcon(icon)).toBe(cat);
  });

  it('uses keyword hints for unknown icons without matching inside words', () => {
    expect(categoryFromIcon('fancy_wine_glass')).toBe('food');
    expect(categoryFromIcon('barber_pole')).toBe('other');
    expect(categoryFromIcon('question_mark')).toBe('other');
    expect(categoryFromIcon(undefined)).toBe('other');
    expect(categoryFromIcon('')).toBe('other');
  });
});

describe('categoryFromTags', () => {
  it('maps OSM amenity/shop/tourism/craft tags', () => {
    expect(categoryFromTags({ amenity: 'restaurant' })).toBe('food');
    expect(categoryFromTags({ amenity: 'pub' })).toBe('food');
    expect(categoryFromTags({ amenity: 'cafe' })).toBe('cafe');
    expect(categoryFromTags({ shop: 'bakery' })).toBe('cafe');
    expect(categoryFromTags({ shop: 'supermarket' })).toBe('groceries');
    expect(categoryFromTags({ shop: 'hairdresser' })).toBe('services');
    expect(categoryFromTags({ shop: 'clothes' })).toBe('shops');
    expect(categoryFromTags({ tourism: 'hotel' })).toBe('lodging');
    expect(categoryFromTags({ amenity: 'atm' })).toBe('atm');
    expect(categoryFromTags({ craft: 'carpenter' })).toBe('services');
    expect(categoryFromTags({ amenity: 'dentist' })).toBe('services');
    expect(categoryFromTags({ tourism: 'museum' })).toBe('other');
    expect(categoryFromTags(null)).toBe('other');
  });

  it('accepts BTC Map osm:-prefixed keys', () => {
    expect(categoryFromTags({ 'osm:amenity': 'cafe' })).toBe('cafe');
  });

  it('categorize prefers tags, then falls back to the icon', () => {
    expect(categorize({ icon: 'storefront', tags: { amenity: 'cafe' } })).toBe('cafe');
    expect(categorize({ icon: 'hotel', tags: { tourism: 'museum' } })).toBe('lodging');
  });
});

describe('normalizePlace', () => {
  it('keeps usable places and derives the category', () => {
    const p = normalizePlace({
      id: 2, lat: 46, lon: 8.9, name: ' Boatcenter ', icon: 'local_cafe',
      address: '', website: 'https://x.ch', osm_id: 'node:1',
    });
    expect(p).toEqual(expect.objectContaining({
      id: 2, name: 'Boatcenter', category: 'cafe', website: 'https://x.ch', osmId: 'node:1',
    }));
    expect(p?.address).toBeUndefined();
  });

  it('drops places without id, name, coordinates, or that are deleted', () => {
    expect(normalizePlace({ lat: 1, lon: 1, name: 'x' })).toBeNull();
    expect(normalizePlace({ id: 1, lat: 1, lon: 1, name: '  ' })).toBeNull();
    expect(normalizePlace({ id: 1, lat: NaN, lon: 1, name: 'x' })).toBeNull();
    expect(normalizePlace({ id: 1, lat: 1, lon: 1, name: 'x', deleted_at: '2025-01-01' })).toBeNull();
  });

  it('normalizePlaces dedupes and ignores non-arrays', () => {
    expect(normalizePlaces({})).toEqual([]);
    const out = normalizePlaces([
      { id: 1, lat: 1, lon: 1, name: 'a' },
      { id: 1, lat: 1, lon: 1, name: 'a again' },
      null,
      { id: 2, lat: 1, lon: 1, name: 'b' },
    ]);
    expect(out.map((p) => p.id)).toEqual([1, 2]);
  });
});

describe('paymentMethodsFromTags', () => {
  it('reads plain and osm:-prefixed payment tags', () => {
    expect(paymentMethodsFromTags({ 'osm:payment:lightning': 'yes', 'osm:payment:onchain': 'no' }))
      .toEqual({ onchain: false, lightning: true, contactless: false });
    expect(paymentMethodsFromTags({ 'payment:onchain': 'yes', 'payment:lightning_contactless': 'yes' }))
      .toEqual({ onchain: true, lightning: true, contactless: true });
    expect(paymentMethodsFromTags(undefined)).toEqual({ onchain: false, lightning: false, contactless: false });
  });
});

describe('distance and sorting', () => {
  it('computes haversine distance', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    const d = distanceMeters({ lat: 46.0, lng: 8.95 }, { lat: 46.01, lng: 8.95 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it('sorts nearest first, ties by name', () => {
    const from = { lat: 46, lng: 9 };
    const list = withDistance([
      place({ id: 1, name: 'Far', lat: 46.1 }),
      place({ id: 2, name: 'B', lat: 46.001 }),
      place({ id: 3, name: 'A', lat: 46.001 }),
    ], from);
    expect(sortByDistance(list).map((p) => p.id)).toEqual([3, 2, 1]);
  });

  it('formats distances', () => {
    expect(formatDistance(42)).toBe('40 m');
    expect(formatDistance(999)).toBe('1000 m');
    expect(formatDistance(2400)).toBe('2.4 km');
    expect(formatDistance(23456)).toBe('23 km');
    expect(formatDistance(NaN)).toBe('');
  });
});

describe('filtering', () => {
  const places = [
    place({ id: 1, name: 'Café Bär', category: 'cafe', address: 'Via Nassa 1' }),
    place({ id: 2, name: 'Pizza Uno', category: 'food', icon: 'local_pizza' }),
    place({ id: 3, name: 'Hotel Lago', category: 'lodging' }),
  ];

  it('folds accents and case', () => {
    expect(foldText('  Café BÄR ')).toBe('cafe bar');
  });

  it('filters by category and accent-insensitive query across fields', () => {
    expect(filterPlaces(places, { category: 'cafe' }).map((p) => p.id)).toEqual([1]);
    expect(filterPlaces(places, { query: 'cafe' }).map((p) => p.id)).toEqual([1]);
    expect(filterPlaces(places, { query: 'nassa' }).map((p) => p.id)).toEqual([1]);
    expect(filterPlaces(places, { query: 'pizza' }).map((p) => p.id)).toEqual([2]);
    expect(filterPlaces(places, { query: 'lodging' }).map((p) => p.id)).toEqual([3]);
    expect(filterPlaces(places, { query: 'hotel lago' }).map((p) => p.id)).toEqual([3]);
    expect(filterPlaces(places, { category: 'food', query: 'hotel' })).toEqual([]);
    expect(filterPlaces(places, {})).toHaveLength(3);
  });

  it('counts per category after the query', () => {
    const counts = countByCategory(places);
    expect(counts.all).toBe(3);
    expect(counts.cafe).toBe(1);
    expect(counts.atm).toBe(0);
    expect(Object.keys(counts)).toHaveLength(PLACE_CATEGORIES.length + 1);
    expect(countByCategory(places, 'pizza').all).toBe(1);
  });
});

describe('links', () => {
  const p = { lat: 46.1, lon: 8.9, name: 'Bar & Co' };
  it('builds platform directions links', () => {
    expect(directionsUrl(p, 'ios')).toBe('http://maps.apple.com/?daddr=46.1,8.9&q=Bar%20%26%20Co');
    expect(directionsUrl(p, 'android')).toBe('geo:0,0?q=46.1,8.9(Bar%20%26%20Co)');
    expect(directionsUrl(p, 'web')).toContain('destination=46.1,8.9');
  });

  it('normalises website and phone', () => {
    expect(websiteUrl('example.com')).toBe('https://example.com');
    expect(websiteUrl('http://example.com')).toBe('http://example.com');
    expect(websiteUrl('  ')).toBeUndefined();
    expect(phoneUrl('+41 91 923 57 33')).toBe('tel:+41919235733');
    expect(phoneUrl(undefined)).toBeUndefined();
  });

  it('links to BTC Map by OSM id when known', () => {
    expect(btcMapPlaceUrl({ id: 2, osmId: 'node:10004226017' })).toBe('https://btcmap.org/merchant/node:10004226017');
    expect(btcMapPlaceUrl({ id: 2 })).toBe('https://btcmap.org/merchant/2');
  });
});
