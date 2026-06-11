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
  type BtcMapMerchant,
  type Coords,
} from './btcmapService';
import LUGANO_MERCHANTS_DATA from '../assets/lugano-merchants.json';

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

async function findMerchantLocations({ query, category, near_address, radius_km, limit = 10 }: FindArgs) {
  const max = Math.max(1, Math.min(20, limit || 10));
  const radiusMeters = Math.max(0.25, Math.min(50, radius_km || 5)) * 1000;

  // Search centre: an explicit address (geocoded) wins, otherwise the device's
  // real location (which itself falls back to Lugano without permission).
  let center: Coords | null = null;
  let centerLabel: string | undefined;
  let precise = false;
  try {
    if (near_address && near_address.trim().length >= 2) {
      center = await geocodeAddress(near_address);
      centerLabel = near_address;
      precise = !!center;
    }
    if (!center) {
      const loc = await getUserLocation();
      center = loc.coords;
      centerLabel = loc.label;
      precise = loc.precise;
    }
  } catch (e) {
    console.warn('[AI/merchant] location resolution failed:', e);
  }

  if (center) {
    try {
      const found = await findNearbyMerchants({ center, radiusMeters, query, category, limit: max });
      const where = centerLabel || (precise ? 'your location' : 'Lugano (default)');
      return {
        success: true,
        source: 'btcmap',
        precise_location: precise,
        center,
        merchants: found.map((m: BtcMapMerchant) => ({
          id: m.id,
          name: m.name,
          address: m.address,
          category: m.category,
          icon: m.icon,
          lat: m.lat,
          lon: m.lon,
          distance_m: m.distance_m,
          phone: m.phone,
          website: m.website,
          opening_hours: m.opening_hours,
          accepts_bitcoin: m.accepts_onchain,
          accepts_lightning: m.accepts_lightning,
        })),
        total_found: found.length,
        message:
          found.length > 0
            ? `Found ${found.length} Bitcoin merchant${found.length === 1 ? '' : 's'} near ${where}${query ? ` matching "${query}"` : ''}.`
            : `No Bitcoin merchants found within ${radiusMeters / 1000} km of ${where}. Try widening the radius.`,
      };
    } catch (e) {
      console.warn('[AI/merchant] BTC Map query failed, using offline list:', e);
    }
  }

  // Offline fallback — static Lugano dump (no location and/or no network).
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
  return {
    success: true,
    source: 'offline',
    precise_location: false,
    merchants: results.map((m) => ({
      id: m.id,
      name: m.name,
      address: m.address,
      category: m.icon,
      phone: m.phone,
      website: m.website,
      opening_hours: m.opening_hours,
      accepts_bitcoin: true,
      accepts_lightning: true,
    })),
    total_found: filtered.length,
    message: `Showing ${results.length} Lugano merchant${results.length === 1 ? '' : 's'} (offline list — couldn't reach BTC Map or your location).`,
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
      "Find Bitcoin-accepting merchants near the user's real location using live BTC Map data. Defaults to the device's current GPS location. Use when the user wants merchants, shops, restaurants, cafes, or places to spend Bitcoin nearby.",
    parameters: z.object({
      query: z.string().optional().describe('Optional filter for merchant name or type (e.g. "coffee")'),
      category: z.string().optional().describe('Optional category filter (restaurant, cafe, bar, shop, grocery, lodging, atm)'),
      near_address: z.string().optional().describe('Optional address/city to search around instead of the current location'),
      radius_km: z.number().optional().describe('Search radius in km (0.25–50, default 5)'),
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
