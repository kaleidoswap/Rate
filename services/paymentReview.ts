export interface PaymentFeeRequest {
  method: string;
  destination: string;
  amountSats: number;
  amountless?: boolean;
}

export interface PaymentFeeAdapter {
  quotePaymentFee?: (request: PaymentFeeRequest) => Promise<number | null>;
  /** Bark's estimator, by payment kind (its adapter has no quotePaymentFee). */
  backend?: {
    estimatePaymentFee?: (kind: 'lightning' | 'ark' | 'onchain', amountSats: number, address?: string) => Promise<{ feeSats: unknown }>;
  };
}

/** Send-screen route method → Bark fee kind. */
const BARK_FEE_KIND: Record<string, 'lightning' | 'ark' | 'onchain'> = { lightning: 'lightning', arkade: 'ark', bark: 'ark', bitcoin_l1: 'onchain' };

function quoteFee(adapter: PaymentFeeAdapter, request: PaymentFeeRequest): Promise<unknown> | null {
  if (adapter.quotePaymentFee) return adapter.quotePaymentFee(request);
  const kind = BARK_FEE_KIND[request.method];
  const bark = adapter.backend?.estimatePaymentFee;
  if (!bark || !kind || !(request.amountSats > 0)) return null;
  return bark(kind, request.amountSats, kind === 'onchain' ? request.destination : undefined).then(r => r?.feeSats);
}

/** Unknown fees stay unknown; zero is only valid when returned by the provider. */
export function validFeeSats(value: unknown): number | null {
  if (!['number', 'bigint', 'string'].includes(typeof value) || (typeof value === 'string' && value.trim() === '')) return null;
  const fee = Number(value);
  return Number.isSafeInteger(fee) && fee >= 0 ? fee : null;
}

export async function estimatePaymentFee(adapter: PaymentFeeAdapter | null, request: PaymentFeeRequest): Promise<number | null> {
  const quoted = adapter ? quoteFee(adapter, request) : null;
  if (!quoted) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return validFeeSats(await Promise.race([
      quoted,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 15000); }),
    ]));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function paymentTotal(amountSats: number, feeSats: number | null): number | null {
  return feeSats === null ? null : amountSats + feeSats;
}
