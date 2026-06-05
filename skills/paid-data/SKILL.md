---
name: paid-data
description: Fetch premium or paywalled data that requires a small Lightning (L402) payment — paid feeds, gated APIs, unlockable resources. Triggers when the user wants premium, paid, or unlockable data behind an L402 paywall.
tools: fetch_paid_resource
triggers: premium, paid, l402, feed, subscription, unlock, paywall
---

# Paid data

Fetch L402-paywalled resources, paying small Lightning invoices automatically
with `fetch_paid_resource`. Small amounts pay without prompting (capped);
anything larger is declined. Tell the user what was paid and what was returned.
