---
name: merchant-finder
description: Find Bitcoin-accepting merchants and places, especially around Lugano. Triggers when the user asks where to spend Bitcoin, for a shop, store, or restaurant that accepts Bitcoin, or for merchants nearby.
tools: find_merchant_locations, get_merchant_info
triggers: merchant, shop, store, restaurant, lugano, accept, nearby, where, place, spend
---

# Merchant finder

Find merchants that accept Bitcoin near the user.

- Use `find_merchant_locations` for the area in question (default to the user's
  current location, e.g. Lugano).
- Use `get_merchant_info` to share a specific merchant's details, then offer to
  show it on the map.
