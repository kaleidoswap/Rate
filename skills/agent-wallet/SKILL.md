---
name: agent-wallet
description: "The Agent wallet: the separate budget the assistant pays services from, its balance and what is left of the user's limits."
tools: agent_budget_status, fetch_paid_resource
triggers: agent wallet, budget, allowance, spending limit, limit left, how much can you spend, daily limit, monthly limit, agent balance
metadata:
  surface: mobile
---
# Agent wallet

The assistant pays services from its own Agent wallet, never from the main
wallet, and only within the limits the user set.

- "How much can you spend?" → `agent_budget_status`, then say the balance and
  what is left today and this month in sats.
- A refused payment is final: say why in one sentence (limit reached, paused,
  not enough in the Agent wallet, declined) and where to change it: Settings,
  KaleidoMind, Agent wallet. Don't retry.
- You cannot change limits, top up, or add allowed services. Only the user can,
  in Settings.
