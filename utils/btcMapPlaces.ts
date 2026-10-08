// utils/btcMapPlaces.ts
//
// Pure helpers for the Places-to-pay map: BTC Map place normalisation,
// category mapping (from BTC Map's icon name or raw OSM tags), distance,
// search/filter and deep links. No React, no network.

export interface Coords {
  lat: number;
  lng: number;
}

export type PlaceCategory =
  | 'food'
  | 'cafe'
  | 'shops'
  | 'groceries'
  | 'lodging'
  | 'services'
  | 'atm'
  | 'other';

export type CategoryFilter = PlaceCategory | 'all';

export interface CategoryInfo {
  id: PlaceCategory;
  label: string;
  /** Ionicons glyph name. */
  icon: string;
}

export const PLACE_CATEGORIES: CategoryInfo[] = [
  { id: 'food', label: 'Food & drinks', icon: 'restaurant' },
  { id: 'cafe', label: 'Cafés', icon: 'cafe' },
  { id: 'shops', label: 'Shops', icon: 'bag-handle' },
  { id: 'groceries', label: 'Groceries', icon: 'cart' },
  { id: 'lodging', label: 'Lodging', icon: 'bed' },
  { id: 'services', label: 'Services', icon: 'construct' },
  { id: 'atm', label: 'ATMs & exchange', icon: 'cash' },
  { id: 'other', label: 'Other', icon: 'location' },
];

const CATEGORY_BY_ID: Record<PlaceCategory, CategoryInfo> = PLACE_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.id]: c }),
  {} as Record<PlaceCategory, CategoryInfo>,
);

export function categoryInfo(id: PlaceCategory): CategoryInfo {
  return CATEGORY_BY_ID[id] ?? CATEGORY_BY_ID.other;
}

/** A place as the app uses it, normalised from the BTC Map v4 API. */
export interface Place {
  id: number;
  name: string;
  lat: number;
  lon: number;
  category: PlaceCategory;
  /** BTC Map's Material icon name, kept for re-categorisation. */
  icon?: string;
  address?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  verifiedAt?: string;
  osmId?: string;
}

export interface PlaceWithDistance extends Place {
  distanceM: number;
}

// --- Category mapping -------------------------------------------------------

// BTC Map assigns every place a Material Symbols icon derived from its OSM tags.
const ICON_CATEGORY: Record<string, PlaceCategory> = {
  restaurant: 'food', restaurant_menu: 'food', lunch_dining: 'food', dinner_dining: 'food',
  local_pizza: 'food', fastfood: 'food', tapas: 'food', ramen_dining: 'food', set_meal: 'food',
  kebab_dining: 'food', rice_bowl: 'food', brunch_dining: 'food', icecream: 'food',
  local_bar: 'food', sports_bar: 'food', nightlife: 'food', liquor: 'food', wine_bar: 'food',
  local_drink: 'food', sports_bar_outlined: 'food', food_bank: 'food', outdoor_grill: 'food',
  local_cafe: 'cafe', coffee: 'cafe', coffee_maker: 'cafe', bakery_dining: 'cafe',
  emoji_food_beverage: 'cafe', cake: 'cafe', breakfast_dining: 'cafe',
  local_grocery_store: 'groceries', shopping_cart: 'groceries', grocery: 'groceries',
  egg: 'groceries', nutrition: 'groceries', storefront_grocery: 'groceries',
  storefront: 'shops', store: 'shops', shopping_bag: 'shops', local_mall: 'shops',
  diamond: 'shops', local_florist: 'shops', smartphone: 'shops', computer: 'shops',
  checkroom: 'shops', chair: 'shops', menu_book: 'shops', toys: 'shops', watch: 'shops',
  phone_iphone: 'shops', devices: 'shops', local_offer: 'shops', redeem: 'shops',
  sell: 'shops', styler: 'shops', weekend: 'shops', storefront_outlined: 'shops',
  hotel: 'lodging', bed: 'lodging', king_bed: 'lodging', cabin: 'lodging', camping: 'lodging',
  holiday_village: 'lodging', house: 'lodging', apartment: 'lodging', night_shelter: 'lodging',
  currency_exchange: 'atm', currency_bitcoin: 'atm', atm: 'atm', local_atm: 'atm',
  account_balance: 'atm', payments: 'atm',
  content_cut: 'services', spa: 'services', medical_services: 'services',
  local_pharmacy: 'services', build: 'services', design_services: 'services',
  local_printshop: 'services', fitness_center: 'services', school: 'services',
  business: 'services', directions_car: 'services', local_taxi: 'services',
  pedal_bike: 'services', two_wheeler: 'services', visibility: 'services', colorize: 'services',
  car_repair: 'services', local_car_wash: 'services', local_gas_station: 'services',
  local_laundry_service: 'services', dentistry: 'services', medication: 'services',
  pets: 'services', gavel: 'services', home_repair_service: 'services', plumbing: 'services',
  electrical_services: 'services', photo_camera: 'services', computer_outlined: 'services',
  car_rental: 'services', luggage: 'services', work: 'services', real_estate_agent: 'services',
  psychology: 'services', stethoscope: 'services', medical_information: 'services',
  self_improvement: 'services', sports: 'services', handyman: 'services', key: 'services',
  local_shipping: 'services', print: 'services', translate: 'services', engineering: 'services',
};

const word = (s: string, re: RegExp) => re.test(s);

/** Category for a BTC Map icon name. Unknown names fall back to keyword hints. */
export function categoryFromIcon(icon?: string | null): PlaceCategory {
  if (!icon) return 'other';
  const name = icon.trim().toLowerCase();
  const hit = ICON_CATEGORY[name];
  if (hit) return hit;
  if (word(name, /(^|_)(restaurant|dining|pizza|food|burger|bar|pub|beer|wine|liquor)(_|$)/)) return 'food';
  if (word(name, /(^|_)(cafe|coffee|bakery|tea)(_|$)/)) return 'cafe';
  if (word(name, /(^|_)(grocery|cart)(_|$)/)) return 'groceries';
  if (word(name, /(^|_)(hotel|bed|camping|cabin)(_|$)/)) return 'lodging';
  if (word(name, /(^|_)(atm|currency|exchange)(_|$)/)) return 'atm';
  if (word(name, /(^|_)(store|shop|shopping|mall)(_|$)/)) return 'shops';
  return 'other';
}

const FOOD_AMENITY = new Set([
  'restaurant', 'fast_food', 'bar', 'pub', 'biergarten', 'food_court', 'ice_cream', 'nightclub',
]);
const CAFE_SHOP = new Set(['coffee', 'bakery', 'pastry', 'tea', 'confectionery', 'chocolate']);
const GROCERY_SHOP = new Set([
  'supermarket', 'convenience', 'grocery', 'greengrocer', 'butcher', 'deli', 'organic', 'farm',
  'beverages', 'cheese', 'seafood', 'health_food', 'dairy', 'wine', 'alcohol',
]);
const LODGING_TOURISM = new Set([
  'hotel', 'guest_house', 'hostel', 'apartment', 'motel', 'chalet', 'camp_site', 'caravan_site',
  'alpine_hut', 'wilderness_hut',
]);
const ATM_AMENITY = new Set(['atm', 'bureau_de_change', 'bank', 'money_transfer']);
const SERVICE_SHOP = new Set([
  'hairdresser', 'beauty', 'car_repair', 'massage', 'tattoo', 'laundry', 'dry_cleaning',
  'optician', 'travel_agency', 'funeral_directors', 'copyshop', 'repair', 'bicycle_repair',
]);

/** Category from raw OSM tags (amenity / shop / tourism / craft / office …). */
export function categoryFromTags(tags?: Record<string, string | undefined> | null): PlaceCategory {
  if (!tags) return 'other';
  const t = (k: string) => tags[k] ?? tags[`osm:${k}`];
  const amenity = t('amenity');
  const shop = t('shop');
  const tourism = t('tourism');

  if (amenity === 'cafe' || (shop && CAFE_SHOP.has(shop))) return 'cafe';
  if (amenity && FOOD_AMENITY.has(amenity)) return 'food';
  if (amenity && ATM_AMENITY.has(amenity)) return 'atm';
  if (tourism && LODGING_TOURISM.has(tourism)) return 'lodging';
  if (shop && GROCERY_SHOP.has(shop)) return 'groceries';
  if (shop && SERVICE_SHOP.has(shop)) return 'services';
  if (shop) return 'shops';
  if (t('craft') || t('office') || t('healthcare')) return 'services';
  if (amenity) return 'services';
  return 'other';
}

/** Best category: OSM tags when we have them, else the BTC Map icon. */
export function categorize(input: { icon?: string | null; tags?: Record<string, string | undefined> | null }): PlaceCategory {
  const fromTags = categoryFromTags(input.tags);
  if (fromTags !== 'other') return fromTags;
  return categoryFromIcon(input.icon);
}

// --- Normalisation -----------------------------------------------------------

/** Raw BTC Map v4 place (only the fields we read). */
export interface RawBtcMapPlace {
  id?: number;
  lat?: number;
  lon?: number;
  name?: string | null;
  icon?: string | null;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  verified_at?: string | null;
  osm_id?: string | null;
  deleted_at?: string | null;
}

const clean = (v?: string | null) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : undefined;
};

export function normalizePlace(raw: RawBtcMapPlace): Place | null {
  if (!raw || typeof raw.id !== 'number') return null;
  if (raw.deleted_at) return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  const name = clean(raw.name);
  if (!name) return null;
  return {
    id: raw.id,
    name,
    lat: raw.lat as number,
    lon: raw.lon as number,
    icon: clean(raw.icon),
    category: categoryFromIcon(raw.icon),
    address: clean(raw.address),
    phone: clean(raw.phone),
    website: clean(raw.website),
    openingHours: clean(raw.opening_hours),
    verifiedAt: clean(raw.verified_at),
    osmId: clean(raw.osm_id),
  };
}

export function normalizePlaces(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: Place[] = [];
  for (const r of raw) {
    const p = normalizePlace(r as RawBtcMapPlace);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

// --- Payment methods ------------------------------------------------------------

export interface PaymentMethods {
  onchain: boolean;
  lightning: boolean;
  contactless: boolean;
}

/** Read payment:* tags, with or without BTC Map's `osm:` prefix. */
export function paymentMethodsFromTags(tags?: Record<string, unknown> | null): PaymentMethods {
  const yes = (k: string) => {
    const v = tags?.[k] ?? tags?.[`osm:${k}`];
    return typeof v === 'string' && v.toLowerCase() === 'yes';
  };
  const contactless = yes('payment:lightning_contactless');
  const lightning = yes('payment:lightning') || contactless;
  const onchain = yes('payment:onchain') || yes('payment:bitcoin');
  return { onchain, lightning, contactless };
}

// --- Distance, filter, sort ----------------------------------------------------

/** Haversine distance in metres. */
export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function withDistance(places: Place[], from: Coords): PlaceWithDistance[] {
  return places.map((p) => ({ ...p, distanceM: distanceMeters(from, { lat: p.lat, lng: p.lon }) }));
}

export function sortByDistance<T extends { distanceM: number; name: string }>(places: T[]): T[] {
  return [...places].sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name));
}

/** Lower-case, accent-free text for forgiving matching ("Café" ≈ "cafe"). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface PlaceFilter {
  category?: CategoryFilter;
  query?: string;
}

export function matchesQuery(place: Place, query: string): boolean {
  const q = foldText(query);
  if (!q) return true;
  const hay = foldText(
    [place.name, place.address ?? '', categoryInfo(place.category).label, (place.icon ?? '').replace(/_/g, ' ')].join(' '),
  );
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

export function filterPlaces<T extends Place>(places: T[], { category = 'all', query = '' }: PlaceFilter): T[] {
  return places.filter(
    (p) => (category === 'all' || p.category === category) && matchesQuery(p, query),
  );
}

/** Per-category counts (after the text query), for chip badges. */
export function countByCategory(places: Place[], query = ''): Record<CategoryFilter, number> {
  const counts = { all: 0 } as Record<CategoryFilter, number>;
  for (const c of PLACE_CATEGORIES) counts[c.id] = 0;
  for (const p of places) {
    if (!matchesQuery(p, query)) continue;
    counts.all += 1;
    counts[p.category] += 1;
  }
  return counts;
}

/** Human-friendly distance, e.g. "320 m" or "2.4 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Radius (km) that covers a map viewport, from its centre to a corner. */
export function radiusForBounds(center: Coords, northEast: Coords): number {
  return distanceMeters(center, northEast) / 1000;
}

// --- Deep links ------------------------------------------------------------------

export function directionsUrl(place: Pick<Place, 'lat' | 'lon' | 'name'>, os: string): string {
  const ll = `${place.lat},${place.lon}`;
  const label = encodeURIComponent(place.name);
  if (os === 'ios') return `http://maps.apple.com/?daddr=${ll}&q=${label}`;
  if (os === 'android') return `geo:0,0?q=${ll}(${label})`;
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
}

export function websiteUrl(website?: string): string | undefined {
  const w = clean(website);
  if (!w) return undefined;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

export function phoneUrl(phone?: string): string | undefined {
  const p = clean(phone)?.replace(/[^\d+]/g, '');
  return p ? `tel:${p}` : undefined;
}

export function btcMapPlaceUrl(place: Pick<Place, 'id' | 'osmId'>): string {
  const ref = place.osmId && /^(node|way|relation):\d+$/.test(place.osmId) ? place.osmId : String(place.id);
  return `https://btcmap.org/merchant/${ref}`;
}
