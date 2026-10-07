---
name: kaleido-trading
description: "Quote and execute swaps between BTC and other assets on whichever venue lists the pair: KaleidoSwap (RGB USDT, XAUT) or Flashnet (Spark USDB). Pairs, assets, quotes, swap execution and status."
tools: get_price, fiat_to_sats, kaleidoswap_get_assets, kaleidoswap_get_pairs, kaleidoswap_get_quote, kaleidoswap_get_nodeinfo, execute_swap, kaleidoswap_atomic_status
requires-tools: kaleidoswap_get_quote, execute_swap
triggers: quote, swap, trade, rebalance, slippage, pair, pairs, usdt, xaut, usdb, kaleidoswap, flashnet, spark, rfq
metadata:
  author: kaleidoswap
  version: "0.5.0"
  surface: mobile
---
# KaleidoSwap trading (mobile)

The app picks the venue from the pair: KaleidoSwap for `USDT`/`XAUT`, Flashnet
for `USDB`. `USDT` and `USDB` are different coins; never swap one for the other.
Amounts in `kaleidoswap_get_quote` are **display units**: `from_amount: 0.0005`
means 0.0005 BTC (50,000 sats; 1 BTC = 100,000,000 sats).

## Do
- Quote with `from_asset_id`, `to_asset_id` (tickers: `BTC`, `USDT`, `XAUT`,
  `USDB`) and `from_amount`, the amount to sell. No amount given → ask for one.
- Report `send_amount`, `receive_amount` with `receive_unit`, `fee` and
  `venue` as returned. The quote expires in about 60 s.
- Executing moves funds: `execute_swap` with the `quote_id`, only after the
  user says yes to that quote. Then `kaleidoswap_atomic_status` with the
  returned `atomic_id` as `payment_hash`; Flashnet swaps complete at once.
- A pair missing from `kaleidoswap_get_pairs` means that venue is not
  connected: say so.
- `USD` is not `USDT` and `gold` is not `XAUT`: confirm before quoting.

## Examples
- "Quote 0.0005 BTC to USDT" → `kaleidoswap_get_quote {"from_asset_id":"BTC","to_asset_id":"USDT","from_amount":0.0005}`
- "Swap 100k sats into XAUT" → `kaleidoswap_get_quote {"from_asset_id":"BTC","to_asset_id":"XAUT","from_amount":0.001}`
- "Sell 20 USDB for BTC" → `kaleidoswap_get_quote {"from_asset_id":"USDB","to_asset_id":"BTC","from_amount":20}`
- "Yes, do it" → `execute_swap {"quote_id":"<quote_id>"}`
- "Status of my swap" → `kaleidoswap_atomic_status {"payment_hash":"<atomic_id>"}`
