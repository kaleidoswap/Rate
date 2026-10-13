import type { Wallet } from '@arkade-os/sdk';
const flights = new WeakMap<Wallet, Promise<{ finalized: string[]; pending: string[] }>>();
/** Same recovery used by the official service worker. Finalizes already submitted transactions;
 * never chooses recipients, amounts or new coins and never starts a new payment. */
export function recoverArkadePending(wallet: Wallet) {
  let job = flights.get(wallet);
  if (!job) {
    job = wallet.finalizePendingTxs().finally(() => flights.delete(wallet));
    flights.set(wallet, job);
  }
  return job;
}
