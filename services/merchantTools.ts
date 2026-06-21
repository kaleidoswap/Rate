// Merchant tools for the KaleidoMind agent (find_merchant_locations,
// get_merchant_info) as a standalone @kaleidorg/mind ToolSource.
//
// Live data comes from BTC Map (OSM) around the device's real location via
// btcmapService; a static Lugano dump is the offline fallback. Extracted from
// the legacy AIAssistantFunctions so the agent no longer needs that class.

import { z } from 'zod';
import { InProcessToolSource, type InProcessTool, type ToolSource } from '@kaleidorg/mind';
import {
  getUserLocation,
  geocodeAddress,
  findNearbyMerchants,
  distanceMeters,
  formatDistance,
  FALLBACK_COORDS,
  type BtcMapMerchant,
  type Coords,
} from './btcmapService';
import LUGANO_MERCHANTS_DATA from '../assets/lugano-merchants.json';

/** Past this distance from Lugano, the offline Lugano dump is irrelevant — we
 *  must not present it as if it were near the place the user actually asked for. */
const LUGANO_OFFLINE_MAX_M = 40_000;

const LUGANO_MERCHANTS = LUGANO_MERCHANTS_DATA as Array<{
  id: number;
  name: string;
  address: string;
  icon?: string;
  phone?: string;
  website?: string;
  opening_hours?: string;
}>;

/** Substring match scores 1; otherwise the fraction of query chars found in order. */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 1;
  let hits = 0;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      hits++;
      qi++;
    }
  }
  return hits / q.length;
}

interface FindArgs {
  query?: string;
  category?: string;
  near_address?: string;
  radius_km?: number;
  limit?: number;
}

/** Build a clean, model-ready bullet list so a tiny LLM can echo it verbatim
 *  (instead of paraphrasing/inventing names). One merchant per line. */
function formatMerchantList(
  merchants: Array<{ name: string; category?: string; icon?: string; distance_m?: number; accepts_lightning?: boolean }>,
): string {
  return merchants
    .map((m, i) => {
      const bits = [m.category].filter(Boolean);
      if (typeof m.distance_m === 'number') bits.push(formatDistance(m.distance_m));
      bits.push(m.accepts_lightning ? 'Bitcoin + Lightning' : 'Bitcoin');
      return `${i + 1}. ${m.icon ? m.icon + ' ' : ''}${m.name} (${bits.join(', ')})`;
    })
    .join('\n');
}

async function findMerchantLocations({ query, category, near_address, radius_km, limit = 10 }: FindArgs) {
  const max = Math.max(1, Math.min(20, limit || 10));
  const hasAddress = !!near_address && near_address.trim().length >= 2;

  // Search centre: an explicit address (geocoded) wins, otherwise the device's
  // real location (which itself falls back to Lugano without permission).
  let center: Coords | null = null;
  let centerLabel: string | undefined;
  let precise = false;
  try {
    if (hasAddress) {
      center = await geocodeAddress(near_address!);
      centerLabel = near_address!.trim();
      precise = !!center;
    }
    if (!center && !hasAddress) {
      const loc = await getUserLocation();
      center = loc.coords;
      centerLabel = loc.label;
      precise = loc.precise;
    }
  } catch (e) {
    console.warn('[AI/merchant] location resolution failed:', e);
  }

  // A named city/address covers a whole metro area, so default to a wide radius
  // (merchants are spread out — within 5 km of a city centre there are often
  // none). A device "near me" search stays tight. An explicit radius always wins.
  const defaultKm = hasAddress ? 25 : 5;
  const radiusMeters = Math.max(0.25, Math.min(50, radius_km || defaultKm)) * 1000;

  // Whether the static Lugano dump is a sensible offline fallback for THIS query.
  const nearLugano =
    !hasAddress || (!!center && distanceMeters(center, FALLBACK_COORDS) <= LUGANO_OFFLINE_MAX_M);

  if (center) {
    try {
      const found = await findNearbyMerchants({ center, radiusMeters, query, category, limit: max });
      const where = centerLabel || (precise ? 'your location' : 'Lugano (default)');
      const merchants = found.map((m: BtcMapMerchant) => ({
        id: m.id,
        name: m.name,
        address: m.address,
        category: m.category,
        icon: m.icon,
        lat: m.lat,
        lon: m.lon,
        distance_m: m.distance_m,
        distance: formatDistance(m.distance_m),
        phone: m.phone,
        website: m.website,
        opening_hours: m.opening_hours,
        accepts_bitcoin: m.accepts_onchain,
        accepts_lightning: m.accepts_lightning,
      }));
      return {
        success: true,
        source: 'btcmap',
        precise_location: precise,
        center,
        merchants,
        list: formatMerchantList(merchants),
        total_found: found.length,
        message:
          found.length > 0
            ? `Found ${found.length} Bitcoin-accepting merchant${found.length === 1 ? '' : 's'} near ${where}${query ? ` matching "${query}"` : ''} (live BTC Map data). List them exactly as returned — do not invent names, distances, or details.`
            : `BTC Map shows no Bitcoin-accepting merchants within ${Math.round(radiusMeters / 1000)} km of ${where}. Tell the user honestly; do not invent any. They could try a wider radius or a nearby city.`,
      };
    } catch (e) {
      console.warn('[AI/merchant] BTC Map query failed:', e);
      // For a far-away named city the offline Lugano dump is misleading — be
      // honest instead of presenting Lugano venues as if they were there.
      if (!nearLugano) {
        return {
          success: false,
          source: 'btcmap',
          merchants: [],
          total_found: 0,
          message: `I couldn't reach the live BTC Map data for ${centerLabel || 'that area'} right now. Tell the user the lookup failed and to try again shortly — do not list any merchants.`,
        };
      }
      console.warn('[AI/merchant] falling back to offline Lugano list');
    }
  } else if (!nearLugano) {
    return {
      success: false,
      source: 'btcmap',
      merchants: [],
      total_found: 0,
      message: `I couldn't locate ${centerLabel || 'that place'}. Ask the user to rephrase the city or try again — do not list any merchants.`,
    };
  }

  // Offline fallback — static Lugano dump (no location and/or no network), only
  // reached when the search is actually near Lugano.
  let filtered = [...LUGANO_MERCHANTS];
  if (category) {
    const c = category.toLowerCase();
    filtered = filtered.filter((m) => m.icon === c || m.name.toLowerCase().includes(c));
  }
  if (query && query.trim().length >= 2) {
    const q = query.toLowerCase();
    filtered = filtered
      .map((m) => ({ m, score: fuzzyScore(q, m.name) * 3 + fuzzyScore(q, m.address) * 2 + fuzzyScore(q, m.icon ?? '') * 1.5 }))
      .filter((r) => r.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.m);
  }
  const results = filtered.slice(0, max);
  const merchants = results.map((m) => ({
    id: m.id,
    name: m.name,
    address: m.address,
    category: m.icon,
    phone: m.phone,
    website: m.website,
    opening_hours: m.opening_hours,
    accepts_bitcoin: true,
    accepts_lightning: true,
  }));
  return {
    success: true,
    source: 'offline',
    precise_location: false,
    merchants,
    list: formatMerchantList(merchants),
    total_found: filtered.length,
    message: `Showing ${results.length} Bitcoin-accepting merchant${results.length === 1 ? '' : 's'} in Lugano (offline list — couldn't reach live BTC Map or your location). List them exactly as returned and tell the user this is the offline Lugano list; do not invent names or details.`,
  };
}

async function getMerchantInfo({ merchant_id, merchant_name }: { merchant_id?: number; merchant_name?: string }) {
  let merchant: (typeof LUGANO_MERCHANTS)[number] | undefined;
  if (typeof merchant_id === 'number') {
    merchant = LUGANO_MERCHANTS.find((m) => m.id === merchant_id);
  } else if (merchant_name && merchant_name.trim().length >= 2) {
    const q = merchant_name.toLowerCase().trim();
    merchant =
      LUGANO_MERCHANTS.find((m) => m.name.toLowerCase() === q) ??
      LUGANO_MERCHANTS.map((m) => ({ m, score: fuzzyScore(q, m.name.toLowerCase()) }))
        .filter((r) => r.score > 0.5)
        .sort((a, b) => b.score - a.score)[0]?.m;
  }
  if (!merchant) {
    const suggestions = merchant_name
      ? LUGANO_MERCHANTS.map((m) => ({ name: m.name, score: fuzzyScore(merchant_name.toLowerCase(), m.name.toLowerCase()) }))
          .filter((r) => r.score > 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((r) => r.name)
      : undefined;
    throw new Error(
      `Could not find merchant${merchant_name ? ` "${merchant_name}"` : merchant_id ? ` with ID ${merchant_id}` : ''}.` +
        (suggestions?.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''),
    );
  }
  return {
    success: true,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      address: merchant.address,
      category: merchant.icon,
      phone: merchant.phone,
      website: merchant.website,
      opening_hours: merchant.opening_hours,
      accepts_bitcoin: true,
      accepts_lightning: true,
      location: { country: 'Switzerland', city: 'Lugano', region: 'Ticino' },
    },
  };
}

const MERCHANT_TOOLS: InProcessTool[] = [
  {
    name: 'find_merchant_locations',
    description:
      "Find Bitcoin-accepting merchants from live BTC Map (OpenStreetMap) data. Use whenever the user wants merchants, shops, restaurants, cafes, bars, or places to spend Bitcoin. IMPORTANT: if the user names a city or place (e.g. 'in Turin', 'a Torino', 'near Milan'), pass it as `near_address` — otherwise it searches the device's GPS location. Map a food request ('places to eat', 'restaurants', 'dinner') to category 'restaurant'. After it returns, present the merchants EXACTLY as given (use the `list` field) — never invent names, distances, or whether a place accepts Bitcoin.",
    parameters: z.object({
      query: z.string().optional().describe('Optional filter for merchant name or type (e.g. "coffee")'),
      category: z.string().optional().describe('Optional category filter (restaurant, cafe, bar, shop, grocery, lodging, atm)'),
      near_address: z.string().optional().describe('City, address, or place to search around (e.g. "Turin", "Torino, Italy"). Set this whenever the user mentions a location instead of "near me".'),
      radius_km: z.number().optional().describe('Search radius in km (0.25–50). Defaults to 25 for a named city, 5 for the current location.'),
      limit: z.number().optional().describe('Maximum number of results (1-20, default 10)'),
    }),
    handler: (args) => findMerchantLocations(args as FindArgs),
  },
  {
    name: 'get_merchant_info',
    description: 'Get detailed information about a specific merchant by ID or name.',
    parameters: z.object({
      merchant_id: z.number().optional().describe('Merchant ID number'),
      merchant_name: z.string().optional().describe('Merchant name'),
    }),
    handler: (args) => getMerchantInfo(args as { merchant_id?: number; merchant_name?: string }),
  },
];

/** The merchant ToolSource for the engine (find + info). */
export function buildMerchantToolSource(): ToolSource {
  return new InProcessToolSource('merchant', MERCHANT_TOOLS);
}
