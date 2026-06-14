---
name: kaleido-lsps
description: "Buy inbound Lightning channel capacity from a Lightning Service Provider (LSPS1). Quote, estimate fees, and create a channel order. Triggers when the user wants inbound liquidity, can't receive a payment, needs a channel, or asks about LSP fees."
tools: lsp_get_info, lsp_get_network_info, lsp_estimate_fees, lsp_create_order, lsp_get_order
triggers: inbound, liquidity, channel order, lsp, lsps1, receive limit, can't receive, open channel
metadata:
  author: kaleidoswap
  version: "0.1.0"
---

# Lightning channel orders (LSPS1)

Buy inbound Lightning channel capacity from a Lightning Service Provider when
the user can't receive a payment (no inbound liquidity) or wants a bigger
receive limit. The host binds these to whichever LSP it talks to — the
KaleidoSwap maker by default, but the contract is LSP-agnostic (`lsp_*`).

## Critical rules

You have **no knowledge of LSP fees, channel sizes, or order status**. Every
number, capacity, fee, or order id in your reply MUST come from a tool result
returned in the CURRENT turn. Never quote a fee from memory. Never claim an
order completed without calling `lsp_get_order`. Never reuse a number from a
previous turn.

**Calling the tool IS the answer.** Don't write "the LSP info is fetched with
`lsp_get_info`" — call it.

If a tool needs a required argument the user didn't give (e.g. an `order_id`
when polling), ASK. Don't loop the same failing call.

## Flow

1. **Check the LSP first.** Call `lsp_get_info` once per session to learn the
   min/max channel size and the fee structure. Use those numbers to validate
   the user's request (e.g. "200k sats" against `min_channel_sat`).
2. **Estimate before ordering.** Call `lsp_estimate_fees` with the desired
   `lsp_balance_sat`. Surface the total cost explicitly — never hide it.
3. **Show + confirm.** State: inbound capacity requested, total fee, expiry
   (if applicable), and the LSP node URI from `lsp_get_network_info` (so the
   user knows the counterparty). The next step is spend-gated.
4. **Create the order.** Call `lsp_create_order` with the same parameters.
   The host pauses for explicit confirmation. Returns an `order_id` and a
   Lightning invoice the user must pay to lock the order.
5. **Track it.** Poll `lsp_get_order` until the channel opens (status
   `completed`) or fails. Report the outcome plainly.

## Rules

- **Re-estimate when parameters change.** Don't reuse an estimate across
  different channel sizes or expiries.
- **Never invent capacity / fees / pubkeys.** Tool results are the truth.
- **Lightning over on-chain for ordering.** LSPS1 orders are paid by
  Lightning invoice; if Lightning isn't available, say so and stop.
- **A channel order is not the same as a payment.** Make this explicit when
  the user confuses them.
