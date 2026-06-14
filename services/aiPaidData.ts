// Paid-data (L402) tool source for the KaleidoMind agent.
//
// Exposes `fetch_paid_resource(url)` — the "agent pays for a tool in sats"
// capability. kaleido-mind owns the L402 flow (402 challenge → pay invoice →
// re-fetch with the preimage); the host injects how to pay. On mobile that's
// the on-device Lightning wallet, so the payment stays non-custodial + private.
//
// Safety: the spend is confirmation-gated AND bounded by a small auto-pay cap.
// The 402 challenge amount is only known mid-execution, so the cap is the hard
// guardrail — anything above it is declined before paying. The paid-data skill
// scopes the agent to this single tool.

import { createL402ToolSource, type ToolSource } from '@kaleidorg/mind';
import { payLightningInvoice } from './walletTools';

/** Reject any L402 invoice above this — bounds blind auto-pay. */
export const L402_MAX_AUTOPAY_SATS = 1000;

const log = (...a: any[]) => { try { console.log('[AI/l402]', ...a); } catch { /* noop */ } };

export function buildPaidDataToolSource(): ToolSource {
  return createL402ToolSource({
    payInvoice: (invoice, amountSats) => payLightningInvoice(invoice, amountSats),
    requiresConfirmation: true,
    maxAutoPaySats: L402_MAX_AUTOPAY_SATS,
    log: (m) => log(m),
  });
}
