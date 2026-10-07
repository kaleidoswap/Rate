import { SparkWdkAdapter } from '@kaleidorg/wallet-engine/adapters/wdk';
import { validFeeSats, type PaymentFeeRequest } from '../paymentReview';

import { createSparkPayAccount } from '../kaleidoPay/sparkAccount';

/**
 * A Spark transfer's status as a payment outcome. The SDK returns the proto
 * enum as a number (5 = COMPLETED), which the engine reads as text and so
 * always as "pending": a sent payment then never resolved and kept Send locked.
 * Once the sender's key tweak is done the receiver can claim, so it is paid.
 */
export function sparkTransferStatus(status: unknown): 'confirmed' | 'failed' | 'pending' {
  const NAMES = ['SENDER_INITIATED', 'SENDER_KEY_TWEAK_PENDING', 'SENDER_KEY_TWEAKED', 'RECEIVER_KEY_TWEAKED', 'RECEIVER_REFUND_SIGNED',
    'COMPLETED', 'EXPIRED', 'RETURNED', 'SENDER_INITIATED_COORDINATOR', 'RECEIVER_KEY_TWEAK_LOCKED', 'RECEIVER_KEY_TWEAK_APPLIED', 'APPLYING_SENDER_KEY_TWEAK'];
  const name = typeof status === 'number' ? NAMES[status] ?? '' : String(status ?? '').toUpperCase().replace(/^TRANSFER_STATUS_/, '');
  if (name === 'EXPIRED' || name === 'RETURNED' || name.includes('FAIL')) return 'failed';
  if (['SENDER_KEY_TWEAKED', 'RECEIVER_KEY_TWEAKED', 'RECEIVER_REFUND_SIGNED', 'COMPLETED', 'RECEIVER_KEY_TWEAK_LOCKED', 'RECEIVER_KEY_TWEAK_APPLIED'].includes(name)
    || name.includes('COMPLET')) return 'confirmed';
  return 'pending';
}

/** Expose the WDK's read-only fee quotes without sending a payment. */
export class MobileSparkAdapter extends SparkWdkAdapter {
  /**
   * Adds Spark transfers received but not yet claimed (the SDK claims them
   * every ~10 s) as unconfirmed, so they show as "Incoming" instead of being
   * invisible. `confirmed` stays what can be spent now.
   */
  async getBtcBalance() {
    const base = await super.getBtcBalance();
    let incoming = 0;
    try {
      const wallet: any = (this as any).rawWallet;
      if (typeof wallet?.getCachedBalance === 'function') {
        incoming = Number((await wallet.getCachedBalance())?.satsBalance?.incoming ?? 0);
      }
    } catch { /* the cached read is local; keep the spendable balance on any error */ }
    if (!Number.isFinite(incoming) || incoming <= 0) return base;
    return { ...base, unconfirmed: (base.unconfirmed ?? 0) + incoming, total: (base.total ?? 0) + incoming };
  }

  async getPaymentStatus(paymentId: string) {
    const result = await super.getPaymentStatus(paymentId);
    // Only a transfer receipt carries an amount (Lightning sends resolve on their own path).
    if (result.status !== 'pending' || result.amount === undefined) return result;
    const id = paymentId.includes(':') ? paymentId.split(':').pop()! : paymentId;
    try {
      const transfer = await this.account.getTransactionReceipt(id);
      return transfer ? { ...result, status: sparkTransferStatus(transfer.status) } : result;
    } catch {
      return result;
    }
  }

  createPaymentAccount(walletId: number) {
    this.assertConnected();
    if (this.network !== 'mainnet') return null;
    const wallet = this.account?._wallet;
    if (!wallet?.getWithdrawalFeeQuote || !wallet?.withdraw || !wallet?.getCoopExitRequest) return null;
    return createSparkPayAccount(walletId, wallet, () => {
      this.assertConnected();
      if (this.account?._wallet !== wallet || this.network !== 'mainnet') throw new Error('Account changed. Review the payment again.');
    });
  }

  async quotePaymentFee(request: PaymentFeeRequest): Promise<number | null> {
    this.assertConnected();
    if (request.method === 'bitcoin_l1') {
      const quote = await this.account.quoteWithdraw({
        amountSats: request.amountSats,
        withdrawalAddress: request.destination,
      });
      // Match the medium exit used by SparkWdkAdapter.sendBtcOnchain.
      const network = validFeeSats(quote?.l1BroadcastFeeMedium?.originalValue);
      const provider = validFeeSats(quote?.userFeeMedium?.originalValue);
      return network === null || provider === null ? null : network + provider;
    }
    if (request.method === 'lightning' && /^ln(bc|tb|bcrt)/i.test(request.destination)) {
      return validFeeSats(await this.account.quotePayLightningInvoice({
        encodedInvoice: request.destination,
        ...(request.amountless ? { amountSats: request.amountSats } : {}),
      }));
    }
    if (request.method === 'spark') {
      const quote = await this.account.quoteSendTransaction({ to: request.destination, value: BigInt(request.amountSats) });
      return validFeeSats(quote?.fee);
    }
    return null;
  }
}
