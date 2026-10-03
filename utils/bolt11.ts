// utils/bolt11.ts
import { decode } from 'light-bolt11-decoder';

/** Payment hash of a BOLT11 invoice, or null if it can't be decoded. */
export function bolt11PaymentHash(invoice: string): string | null {
  try {
    const section = decode(invoice.trim()).sections.find((x: any) => x.name === 'payment_hash') as any;
    return typeof section?.value === 'string' && /^[a-f0-9]{64}$/i.test(section.value) ? section.value : null;
  } catch {
    return null;
  }
}
