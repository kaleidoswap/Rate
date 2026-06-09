---
name: merchant-finder
description: Find Bitcoin-accepting merchants near the user using live BTC Map data and the device's real location. Triggers when the user asks where to spend Bitcoin, for a shop, store, restaurant, cafe, bar, or ATM that accepts Bitcoin, or for merchants nearby.
tools: find_merchant_locations, get_merchant_info
triggers: merchant, shop, store, restaurant, cafe, bar, atm, accept, nearby, near me, around, where, place, spend, bitcoin map, btcmap
---

# Merchant finder

Find merchants that accept Bitcoin **near the user's real location**, using live
BTC Map (OpenStreetMap) data — never a hardcoded city.

- Call `find_merchant_locations` for "where can I spend Bitcoin / shops / places
  near me". By default it uses the device's **current GPS location**; do NOT
  assume Lugano or any other city.
  - To search elsewhere, pass `near_address` (e.g. "Berlin", "Via Nassa Lugano").
  - Narrow with `query` (e.g. "coffee", "pizza"), `category` (restaurant, cafe,
    bar, shop, grocery, lodging, atm), or widen `radius_km` (default 5 km).
  - Results come back sorted nearest-first with distance, address, opening hours,
    and whether they take Lightning ⚡ and/or on-chain ₿.
- If the result `precise_location` is false (location permission denied) or
  `source` is "offline", tell the user you're showing a default/offline area and
  suggest enabling location for accurate "near me" results.
- Use `get_merchant_info` to share one merchant's details, then offer to open it
  on the map.

Keep replies to one short sentence — the merchant card already shows the list,
distances, and map/call/website buttons.
