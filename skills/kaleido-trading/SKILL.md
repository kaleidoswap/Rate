---
name: kaleido-trading
description: "Trade on KaleidoSwap — quote and execute swaps between BTC and RGB assets (USDT, XAUT). Get assets and pairs, pull an executable quote, place a market order, or track an atomic swap end-to-end. Triggers when the user wants a price, a quote, to swap or trade assets, or to rebalance between BTC and stablecoins."
tools: get_price, fiat_to_sats, kaleidoswap_get_assets, kaleidoswap_get_pairs, kaleidoswap_get_quote, kaleidoswap_get_nodeinfo, kaleidoswap_place_order, kaleidoswap_get_order_status, kaleidoswap_get_order_history
triggers: quote, swap, trade, rebalance, slippage, pair, pairs, usdt, xaut, kaleidoswap, rfq
metadata:
  author: kaleidoswap
  version: "0.3.0"
---

# KaleidoSwap trading

Quote and execute swaps on the KaleidoSwap maker. The model picks tools by
name; the host binds them through whichever transport it runs over (WDK on
mobile, HTTP/MCP/CLI on desktop).

## Critical rules — these override everything else

You have **no knowledge** of any price, quote, fee, pair, or order. Every
number, pair, or quote id in your reply MUST come from a tool result returned
in the CURRENT turn:

- "What's the BTC price?" → call `get_price` and state the number it returns.
- "What pairs are listed?" → call `kaleidoswap_get_pairs` and list them.
- "Quote 100k sats to USDT" → call `kaleidoswap_get_quote(BTC, USDT, 100000)`,
  then state the receive amount + fees from the result.

**Calling the tool IS the answer.** Never write "the pairs are listed using
kaleidoswap_get_pairs" or "the function returns the quote" — just call it.

**Never reuse a number across turns.** If the user asks a new question, the
previous turn's quote, price, or fee is irrelevant — fetch fresh.

**Never invent a quote.** Without a `quote_id` and `receive_amount` returned
this turn, you do not have a quote. Say so and re-quote.

## Asset codes (canonical)

Only these codes are accepted:

- `BTC` (Bitcoin, amounts always in satoshis)
- `USDT` (Tether) — **not** `USD`, **not** `tether`
- `XAUT` (Tether Gold) — **not** `XAU`, **not** `gold`

When the user types `USD` they almost always mean `USDT` — confirm before
quoting. Same for `gold` → `XAUT`. Don't silently substitute.

## Tools

### `kaleidoswap_get_pairs` — no args
Use when the user asks "what can I trade", "list pairs", "what's available",
or before quoting an unfamiliar pair.

### `kaleidoswap_get_quote` — REQUIRES `amount`
Required args: `from_asset` AND `to_asset` AND `amount`. The maker rejects
calls missing any of these.

**If the user didn't give an amount, ASK for it. Do not call the tool with
from/to alone.**

Examples:
- "Quote 100k sats to USDT" → `{from_asset: "BTC", to_asset: "USDT", amount: 100000}`
- "What's the USDT/BTC rate?" → ask: "How many USDT do you want to swap?"
  (no amount → no quote possible).
- "Buy 50 USDT of BTC" → `{from_asset: "USDT", to_asset: "BTC", amount: 50}`
  (USDT is what's being spent).

### `kaleidoswap_place_order(quote_id)` 🔒 spend
Only after `kaleidoswap_get_quote` returned a `quote_id` THIS turn, and only
when the user has explicitly approved the amount + direction.

### `kaleidoswap_get_order_status(order_id)`
Poll after placing an order. Report status plainly — pending, settling,
completed, failed.

## Flow

1. **Pick a pair** — skip when obvious (`BTC/USDT`, `BTC/XAUT`).
2. **Quote** — `kaleidoswap_get_quote`. REQUIRES amount.
3. **Show + confirm** — surface pair, direction, amount in, expected out,
   fees, slippage. **Never hide cost** — a small model must not abbreviate
   fees out of the message.
4. **Place** — spend-gated by the engine. The host pauses for the user.
5. **Track** — poll `kaleidoswap_get_order_status` until it terminates.

## Don'ts

- Don't invent prices, quotes, quote_ids, or order_ids.
- Don't reuse a number from a previous turn.
- Don't describe how a tool works — call it.
- Don't call `kaleidoswap_get_quote` with from/to only — ask for the amount.
- Don't accept `XAU` as `XAUT` or `USD` as `USDT` silently — confirm.
- Don't retry the same failing tool call in a loop. If a call fails, read the
  error and either ask the user, fix the args, or stop.

For the atomic-swap flow (trust-minimised cross-asset swap that the maker
can't settle from balance), use the `kaleido-trading` atomic recipe — the
agentic chain is not safe to plan on a 0.6B model.
