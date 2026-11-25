/** Parse decimal asset units exactly; never round an amount the user entered. */
export function rgbAmountUnits(text: string, precision: number): number | undefined {
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) return;
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > precision) return;
  const units = BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0');
  return units > 0n && units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : undefined;
}

export type RgbReceiveAmount =
  | { kind: 'open' }
  | { kind: 'fixed'; amount: number }
  | { kind: 'invalid'; message: string };

/** Blank leaves the invoice open; any nonblank input must encode exact asset units. */
export function parseRgbReceiveAmount(text: string, precision: number): RgbReceiveAmount {
  const input = text.trim();
  if (!input) return { kind: 'open' };

  // A decimal keyboard can enter a fraction without a leading zero.
  const normalized = /^[.,]/.test(input) ? `0${input}` : input;
  const amount = rgbAmountUnits(normalized, precision);
  if (amount !== undefined) return { kind: 'fixed', amount };

  if (!Number.isInteger(precision) || precision < 0 || precision > 18) {
    return { kind: 'invalid', message: 'The precision for this asset is unavailable.' };
  }
  const format = precision === 0
    ? 'a positive whole number'
    : `a positive amount with up to ${precision} decimal ${precision === 1 ? 'place' : 'places'}`;
  return { kind: 'invalid', message: `Enter ${format} within the supported range.` };
}
