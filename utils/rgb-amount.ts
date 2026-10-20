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
