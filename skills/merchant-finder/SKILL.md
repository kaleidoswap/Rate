---
name: merchant-finder
description: "Find Bitcoin-accepting merchants near the user using live BTC Map data and the device's real location. Triggers when the user asks where to spend Bitcoin, for a shop, store, restaurant, cafe, bar, or ATM that accepts Bitcoin, or for merchants nearby."
tools: find_merchant_locations, get_merchant_info
triggers: merchant, merchants, shop, shops, store, stores, restaurant, restaurants, cafe, cafes, bar, bars, atm, atms, accept, accepts, accepting, nearby, near me, around, place, places, spend, find, pizza, food, coffee, bitcoin map, btcmap
metadata:
  author: kaleidoswap
  version: "0.2.0"
  homepage: "https://btcmap.org"
---

# Merchant finder

Discover places that accept Bitcoin payments — cafés, restaurants, bars, shops,
and ATMs. Live BTC Map data when the host injects a fetcher + location;
otherwise a small offline list keeps the skill answerable.

## Critical rule — never answer from memory

You have **no knowledge of any merchant**. Every place, name, address and
distance in your reply MUST come from a `find_merchant_locations` result
returned in the CURRENT turn. **Call `find_merchant_locations` for every
place question**, even if a similar question was answered earlier — do NOT
reuse or adapt a previous answer. Never invent a merchant.

## How to call the tools

1. **Start with `find_merchant_locations`.** Pass ONLY the fields the user
   actually named — do not invent constraints:

   - `query` — a specific thing the user named (e.g. `"tapas"`, `"coffee"`,
     `"pizza"`). Omit when they only said "near me" or only named a place.

   - `category` — must be EXACTLY one of: `restaurant`, `cafe`, `bar`, `shop`,
     `grocery`, `lodging`, `atm`. **Anything else is invalid — leave it empty.**
     The words "merchant", "merchants", "place", "places", "store", "stores"
     are NOT categories — they're the generic noun for what you're searching
     for, so they belong in `query` at best, never in `category`.

   - `near_address` — a city, neighbourhood, or address (e.g. `"Milan"`,
     `"Bitcoin Beach, El Salvador"`). Use this any time the user names a
     location instead of "near me".

   - `radius_km` — **omit unless the user names a specific number.** The
     default (5 km) is a sensible search radius for a city. Don't pick a
     small radius (1, 2, 3) yourself — city-wide searches need 5+.

   - `limit` — 1–20, default 10. Omit unless the user names a count.

   Examples (positive):
   - "where can I spend btc near me" → `find_merchant_locations({})`
   - "find merchants in Milan" → `find_merchant_locations({ near_address: "Milan" })`
     ↑ no `category` — "merchants" is NOT a category.
   - "cafes in Lisbon" → `find_merchant_locations({ category: "cafe", near_address: "Lisbon" })`
   - "pizza places in Switzerland that take bitcoin" →
     `find_merchant_locations({ query: "pizza", near_address: "Switzerland" })`
     ↑ "places" is NOT a category — pizza goes in `query`.
   - "lightning bars in NYC, within 2 km" →
     `find_merchant_locations({ category: "bar", near_address: "New York", radius_km: 2 })`
     ↑ user explicitly said "2 km" → set radius_km.

   Examples (anti — do NOT do these):
   - ❌ `category: "merchant"` (not a category)
   - ❌ `category: "place"` (not a category)
   - ❌ `radius_km: 2` when the user didn't say "2 km" — you're picking a
     too-small radius and the result will be empty.

2. **Present the results.** Each row carries:
   - `name`, `category`, `address`
   - `distance_m` when present — show in metres or km
   - `accepts_bitcoin` / `accepts_lightning` — relevant because Lightning is
     fastest for small payments
   - `phone`, `website`, `opening_hours` when present — surface if asked

3. **Use `get_merchant_info` only when** the user asks for more detail on one
   specific result. Pass `merchant_id` (preferred) or `merchant_name`.

## Reply style

- Be concise. One line per merchant works:
  `Name — category, address (X m away, accepts: lightning, onchain)`.
- If the result `source` is `offline`, say so plainly — it means the live
  BTC Map fetch wasn't available, so the list is limited.
- If `find_merchant_locations` returns zero merchants, say so — don't invent
  places. Suggest widening `radius_km` or trying `near_address`.
- When the user says "near me" and `precise_location` is false, mention which
  fallback location was used so they know it's not their actual GPS.
