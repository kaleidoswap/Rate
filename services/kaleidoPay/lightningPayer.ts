import type { LightningPayer } from '@universal-bolt12/swap-market';

/** The part of a wallet-engine adapter KaleidoPay needs to pay Lightning invoices. */
export interface LightningSender {
  sendPayment(request: { invoice: string; amount?: number }): Promise<{ paymentHash: string; status: string }>;
  getPaymentStatus(hash: string): Promise<{ status: string; error?: string }>;
}

const SETTLED = new Set(['confirmed', 'succeeded', 'completed', 'paid']);

/**
 * Sends every invoice at once and returns when all have settled, or throws as soon as one
 * fails. The swap's main invoice stays pending until our claim reveals the preimage, so the
 * sender must not block on it (Bark's sendPayment uses wait:false).
 */
export function lightningPayerFrom(
  sender: LightningSender,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): LightningPayer {
  return {
    async payInvoices(invoices) {
      const sent = await Promise.all(invoices.map(invoice => sender.sendPayment({ invoice })));
      const failed = sent.find(s => s.status === 'failed');
      if (failed) throw new Error(`Lightning payment ${failed.paymentHash.slice(0, 12)} failed`);
      let open = sent.filter(s => !SETTLED.has(s.status)).map(s => s.paymentHash);
      const deadline = Date.now() + (opts.timeoutMs ?? 60 * 60 * 1000);
      while (open.length) {
        if (Date.now() > deadline) throw new Error('Lightning payments did not settle in time');
        await new Promise(r => setTimeout(r, opts.pollMs ?? 3000));
        const states = await Promise.all(open.map(async hash => ({ hash, ...(await sender.getPaymentStatus(hash)) })));
        const bad = states.find(s => s.status === 'failed');
        if (bad) throw new Error(`Lightning payment ${bad.hash.slice(0, 12)} failed${bad.error ? `: ${bad.error}` : ''}`);
        open = states.filter(s => !SETTLED.has(s.status)).map(s => s.hash);
      }
    },
  };
}
