---
name: bitrefill
description: Shop with Bitcoin via Bitrefill — gift cards, mobile/phone top-ups, eSIM data plans, in 180+ countries. Triggers when the user mentions Bitrefill, a gift card, a mobile top-up, an eSIM, or refilling a phone.
triggers: gift card, giftcard, bitrefill, top-up, topup, refill, esim, sim, amazon, steam, voucher, mobile, recharge
metadata:
  surface: mobile
  note: full bitrefill skill + MCP live on the paired desktop, not the phone
---

# Bitrefill (mobile)

Bitrefill purchases run on the paired KaleidoSwap **desktop**, which hosts the
official Bitrefill agent skill and MCP. This phone is not a Bitrefill client.

1. If a desktop is paired (P2P delegation active): confirm the product, country
   and value with the user, then hand the purchase off to the desktop brain and
   relay its result (and the redemption code) back here.
2. If no desktop is paired: give the user a https://www.bitrefill.com link for
   the product and explain they can pair a desktop to buy in-chat.

Never invent an order code or claim a purchase succeeded — only the desktop MCP
can complete a buy.
