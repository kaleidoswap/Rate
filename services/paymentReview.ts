export interface PaymentFeeRequest {
  method: string;
  destination: string;
  amountSats: number;
  amountless?: boolean;
}

export interface PaymentFeeAdapter {
  quotePaymentFee?: (request: PaymentFeeRequest) => Promise<number | null>;
}

/** Unknown fees stay unknown; zero is only valid when returned by the provider. */
export function validFeeSats(value: unknown): number | null {
  if (!['number', 'bigint', 'string'].includes(typeof value) || (typeof value === 'string' && value.trim() === '')) return null;
  const fee = Number(value);
  return Number.isSafeInteger(fee) && fee >= 0 ? fee : null;
}

export async function estimatePaymentFee(adapter: PaymentFeeAdapter | null, request: PaymentFeeRequest): Promise<number | null> {
  if (!adapter?.quotePaymentFee) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return validFeeSats(await Promise.race([
      adapter.quotePaymentFee(request),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 15000); }),
    ]));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function paymentTotal(amountSats: number, feeSats: number | null): number | null {
  return feeSats === null ? null : amountSats + feeSats;
}
