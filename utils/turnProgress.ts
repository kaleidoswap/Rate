// The status line under a pending assistant reply: the current step, the time
// spent so far and, once a turn has measured the device speed, how long one
// model step can take.

const TOOL_STEP: Record<string, string> = {
  get_balances: 'Checking balances',
  spark_get_balance: 'Checking balances',
  rln_get_balances: 'Checking balances',
  arkade_get_balance: 'Checking balances',
  kaleidoswap_get_quote: 'Getting a quote',
  kaleidoswap_get_pairs: 'Loading swap pairs',
  execute_swap: 'Swapping',
  send_payment: 'Sending',
  rln_pay_invoice: 'Paying the invoice',
  create_invoice: 'Creating an invoice',
  resolve_contact: 'Looking up the contact',
  find_merchant_locations: 'Finding merchants',
  search_knowledge: 'Searching the docs',
};

export function stepForTool(name: string, needsApproval = false): string {
  if (needsApproval) return 'Waiting for your approval';
  return TOOL_STEP[name] ?? `Running ${name.replace(/_/g, ' ')}`;
}

export function turnProgressLabel(
  step: string,
  elapsedMs: number,
  speed: { tokensPerSecond?: number; maxTokens?: number } = {},
): string {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000));
  let label = `${step}… ${secs} s`;
  const { tokensPerSecond: tps, maxTokens } = speed;
  if (tps && tps > 0 && maxTokens && maxTokens > 0) {
    label += ` · a step can take up to ~${Math.ceil(maxTokens / tps)} s at ${Math.round(tps)} tok/s`;
  }
  return label;
}
