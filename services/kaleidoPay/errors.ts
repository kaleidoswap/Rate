/**
 * Thrown when a payment was refused before anything reached a wallet or provider
 * (stale quote, disconnected account, changed terms). The attempt is recorded as
 * failed, not unknown, so it never blocks the next payment.
 */
export class PaymentNotSentError extends Error {}
