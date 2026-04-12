/**
 * Centralized amount conversion utility.
 * All protocol amount conversions go through here.
 */

export const SATS_PER_BTC = 100_000_000
export const MSATS_PER_SAT = 1_000

/**
 * Convert BTC display amount to satoshis.
 */
export function btcToSats(btc: number): number {
  return Math.round(btc * SATS_PER_BTC)
}

/**
 * Convert satoshis to BTC display amount.
 */
export function satsToBtc(sats: number): string {
  return (sats / SATS_PER_BTC).toFixed(8)
}

/**
 * Convert satoshis to millisatoshis.
 */
export function satsToMsats(sats: number): number {
  return sats * MSATS_PER_SAT
}

/**
 * Convert millisatoshis to satoshis.
 */
export function msatsToSats(msats: number): number {
  return Math.floor(msats / MSATS_PER_SAT)
}

/**
 * Convert a display amount to the protocol's native unit (sats for all BTC protocols).
 */
export function toProtocolAmount(
  displayAmount: number,
  bitcoinUnit: 'BTC' | 'sats' | 'mBTC',
): number {
  switch (bitcoinUnit) {
    case 'BTC': return btcToSats(displayAmount)
    case 'mBTC': return Math.round(displayAmount * 100_000)
    case 'sats': return Math.round(displayAmount)
  }
}

/**
 * Convert protocol native amount (sats) to display amount.
 */
export function fromProtocolAmount(
  sats: number,
  bitcoinUnit: 'BTC' | 'sats' | 'mBTC',
): number {
  switch (bitcoinUnit) {
    case 'BTC': return sats / SATS_PER_BTC
    case 'mBTC': return sats / 100_000
    case 'sats': return sats
  }
}

/**
 * Format a display amount for a given asset precision.
 * For BTC: uses bitcoinUnit. For RGB/other assets: uses asset precision.
 */
export function formatAssetAmount(
  rawAmount: number,
  precision: number,
  isBtc: boolean = false,
  bitcoinUnit: 'BTC' | 'sats' | 'mBTC' = 'sats',
): string {
  if (isBtc) {
    const display = fromProtocolAmount(rawAmount, bitcoinUnit)
    if (bitcoinUnit === 'sats') return Math.round(display).toLocaleString()
    if (bitcoinUnit === 'mBTC') return display.toFixed(5)
    return display.toFixed(8)
  }

  if (precision <= 0) return String(rawAmount)
  return (rawAmount / Math.pow(10, precision)).toFixed(precision)
}

/**
 * Parse a user-entered amount string to raw protocol amount.
 */
export function parseAmountInput(
  input: string,
  precision: number,
  isBtc: boolean = false,
  bitcoinUnit: 'BTC' | 'sats' | 'mBTC' = 'sats',
): number {
  const clean = input.replace(/[^\d.]/g, '')
  if (!clean || clean === '.') return 0
  const num = parseFloat(clean) || 0

  if (isBtc) return toProtocolAmount(num, bitcoinUnit)
  return Math.round(num * Math.pow(10, precision))
}
