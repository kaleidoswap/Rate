import { SparkWdkAdapter } from '@kaleidorg/wallet-engine/adapters/wdk';
import { validFeeSats, type PaymentFeeRequest } from '../paymentReview';

/** Expose the WDK's read-only fee quotes without sending a payment. */
export class MobileSparkAdapter extends SparkWdkAdapter {
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
