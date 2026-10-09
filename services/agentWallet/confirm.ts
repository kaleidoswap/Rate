// The confirm sheet of the assistant turn in progress, so a payment that needs
// approval mid-tool can ask the user. No turn, no sheet: the payment is refused.

import type { AgentPayConfirmation } from './agentPay';
import { PAID_RESOURCE_TOOL } from './tools';

type Ask = (call: { name: string; arguments: Record<string, unknown> }) => Promise<{ approved: boolean }>;

let current: ((c: AgentPayConfirmation) => Promise<boolean>) | undefined;

/** Bind the turn's confirm handler; returns the unbind function. */
export function bindAgentConfirm(ask: Ask | undefined): () => void {
  if (!ask) return () => {};
  const fn = async (c: AgentPayConfirmation) => {
    const decision = await ask({
      name: PAID_RESOURCE_TOOL,
      arguments: {
        agent_wallet: true,
        service: c.service,
        amount_sats: c.amountSats,
        fee_sats: c.feeSats,
        invoice: c.invoice,
        why: c.why,
      },
    });
    return decision?.approved === true;
  };
  current = fn;
  return () => {
    if (current === fn) current = undefined;
  };
}

export const agentConfirm = () => current;
