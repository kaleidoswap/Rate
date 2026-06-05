/**
 * Defense-in-depth for AI tool execution.
 *
 * Value-moving tools must be gated behind human confirmation (the tool sets
 * `requiresConfirmation: true`). But that gate is opt-in per tool, so a future
 * fund-moving tool added WITHOUT the flag would silently auto-execute on the
 * agent's say-so. This heuristic is the safety net: any tool whose name looks
 * like it moves value is forced through confirmation even if the flag is absent.
 *
 * The bias is intentional — a false positive only adds a (safe) confirmation
 * prompt, while a false negative would let the AI move funds unattended.
 */
const VALUE_MOVING_PATTERNS: RegExp[] = [
  /\bpay\b/,
  /pay[_-]?/,
  /send/,
  /swap/,
  /withdraw/,
  /transfer/,
  /\bzap/,
  /keysend/,
  /open[_-]?channel/,
  /close[_-]?channel/,
  /\bmint/,
  /issue[_-]?asset/,
  /\bspend/,
  /sign[_-]?(tx|transaction|psbt|message)/,
];

// Receiving / reading never moves value, even though some names contain a
// value-ish substring (e.g. "get_receive_address", "list_sent_payments").
const SAFE_OVERRIDES: RegExp[] = [
  /receive/,
  /^get_/,
  /^list_/,
  /^read_/,
  /history/,
  /balance/,
  /quote/,
  /estimate/,
];

export function isLikelyValueMovingToolName(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  if (SAFE_OVERRIDES.some((re) => re.test(n))) return false;
  return VALUE_MOVING_PATTERNS.some((re) => re.test(n));
}
