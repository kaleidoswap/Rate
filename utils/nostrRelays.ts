export const KALEIDOSWAP_RELAY = 'wss://relay.kaleidoswap.com';
export function relayKey(value: string): string {
  try { const url = new URL(value); return url.toString().replace(/\/$/, ''); }
  catch { return value.trim().replace(/\/$/, ''); }
}
export function withDefaultRelay(relays: string[]): string[] {
  return [...new Set([KALEIDOSWAP_RELAY, ...relays].map(relayKey))];
}
