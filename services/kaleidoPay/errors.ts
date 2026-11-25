/**
 * Thrown when a payment was refused before anything reached a wallet or provider
 * (stale quote, disconnected account, changed terms). The attempt is recorded as
 * failed, not unknown, so it never blocks the next payment.
 */
export type PaymentFailureRecovery = 'retry-price' | 'replace-invoice';

export class PaymentNotSentError extends Error {
  constructor(message: string, public readonly recovery?: PaymentFailureRecovery) {
    super(message);
  }
}

/** A safe explanation when submission may have happened; never retry automatically. */
export class PaymentUncertainError extends Error {}
