// Merchant tools for the KaleidoMind agent (find_merchant_locations,
// get_merchant_info) as a standalone @kaleidorg/mind ToolSource.
//
// Live data comes from BTC Map (OSM) around the device's real location via
// btcmapService. Extracted from
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
  // real location. Do not use a fake default city for "near me".
  let center: Coords | null = null;
  let centerLabel: string | undefined;
  let locationReason: string | undefined;
  try {
    if (near_address && near_address.trim().length >= 2) {
      center = await geocodeAddress(near_address);
      centerLabel = near_address;
      if (!center) locationReason = `could not geocode "${near_address}"`;
    }
    if (!center) {
      const loc = await getUserLocation();
      center = loc.coords;
      centerLabel = loc.label;
    }
  } catch (e) {
    console.warn('[AI/merchant] location resolution failed:', e);
    locationReason = e instanceof Error ? e.message : 'location resolution failed';
  }

  if (!center) {
    return {
      success: false,
      source: 'btcmap',
      precise_location: false,
      location_reason: locationReason,
      merchants: [],
      total_found: 0,
      message: `I couldn't get your location${locationReason ? `: ${locationReason}` : ''}. Please enable location access or provide a city/address.`,
    };
  }

  try {
    const found = await findNearbyMerchants({ center, radiusMeters, query, category, limit: max });
    const where = centerLabel || 'your location';
    return {
      success: true,
      source: 'btcmap',
      precise_location: true,
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
    console.warn('[AI/merchant] BTC Map query failed:', e);
    locationReason = e instanceof Error ? e.message : 'BTC Map query failed';
    return {
      success: false,
      source: 'btcmap',
      precise_location: true,
      location_reason: locationReason,
      center,
      merchants: [],
      total_found: 0,
      message: `I couldn't reach BTC Map right now${locationReason ? `: ${locationReason}` : ''}. Please try again later.`,
    };
  }
}

async function getMerchantInfo({ merchant_id, merchant_name }: { merchant_id?: number; merchant_name?: string }) {
  return {
    success: false,
    error: 'merchant_detail_unavailable',
    merchant_id,
    merchant_name,
    message: 'Detailed merchant lookup requires a live BTC Map result. Please run find_merchant_locations again near your current location or a city/address.',
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
