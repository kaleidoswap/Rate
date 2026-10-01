import AsyncStorage from '@react-native-async-storage/async-storage';
import { validFeeSats } from '../paymentReview';
import type { PayAccount, PaymentResult, Quote } from './index';

/** Minimal Spark SDK surface, injected so quote/execution invariants can be tested. */
export interface SparkPayWallet {
  getWithdrawalFeeQuote(params: { amountSats: number; withdrawalAddress: string }): Promise<any>;
  withdraw(params: { onchainAddress: string; amountSats: number; exitSpeed: 'MEDIUM'; feeQuoteId: string; feeAmountSats: number; deductFeeFromWithdrawalAmount: false }): Promise<any>;
  getCoopExitRequest(id: string): Promise<any>;
}
function resultOf(request: any): PaymentResult {
  const status = request?.status;
  return { status: status === 'SUCCEEDED' ? 'completed' : ['INITIATED', 'INBOUND_TRANSFER_CHECKED', 'TX_SIGNED', 'TX_BROADCASTED', 'WAITING_ON_TX_CONFIRMATIONS'].includes(status) ? 'pending' : 'unknown',
    ...(typeof request?.id === 'string' ? { reference: request.id } : {}) };
  // FAILED/EXPIRED require checking the return of funds before another send.
}
export function createSparkPayAccount(walletId: number, wallet: SparkPayWallet, assertCurrent: () => void): PayAccount {
  const sourceId = `spark-wallet-${walletId}`;
  const quotes = new WeakMap<Quote, { id: string; destination: string }>();
  const referenceKey = (attemptId: string) => `kaleidopay-spark-${walletId}-${attemptId}`;
  return {
    source: { id: sourceId, rail: 'spark:mainnet', network: 'mainnet' }, name: 'Spark · Bitcoin',
    swaps: [{ id: 'spark-withdrawal', from: 'spark:mainnet', to: 'btc:mainnet', network: 'mainnet' }],
    providerNames: { 'spark-withdrawal': 'Spark withdrawal' },
    async quote(preview, route) {
      assertCurrent();
      if (route.to !== 'btc:mainnet' || preview.request.network !== 'mainnet' || !preview.code.address) throw new Error('This account supports Bitcoin on-chain payment requests on mainnet.');
      const fee = await wallet.getWithdrawalFeeQuote({ amountSats: preview.request.amountSat, withdrawalAddress: preview.code.address });
      assertCurrent();
      const network = validFeeSats(fee?.l1BroadcastFeeMedium?.originalValue);
      const provider = validFeeSats(fee?.userFeeMedium?.originalValue);
      const expiresAt = Math.floor(Date.parse(fee?.expiresAt) / 1000);
      if (!fee?.id || network === null || provider === null || !Number.isSafeInteger(expiresAt)) throw new Error('Spark did not return a valid fee quote.');
      const quote: Quote = { recipientSat: preview.request.amountSat, feeSat: network + provider, totalSat: preview.request.amountSat + network + provider, expiresAt };
      quotes.set(quote, { id: fee.id, destination: preview.code.address });
      return quote;
    },
    async execute(preview, _route, quote, attemptId) {
      assertCurrent();
      const saved = quotes.get(quote);
      if (!saved || saved.destination !== preview.code.address) throw new Error('Quote no longer available.');
      // executePaymentOffer persists an at-most-once claim before reaching here.
      const request = await wallet.withdraw({ onchainAddress: saved.destination, amountSats: quote.recipientSat, exitSpeed: 'MEDIUM', feeQuoteId: saved.id, feeAmountSats: quote.feeSat!, deductFeeFromWithdrawalAmount: false });
      if (typeof request?.id === 'string') await AsyncStorage.setItem(referenceKey(attemptId), request.id);
      return resultOf(request);
    },
    async status(attemptId) {
      assertCurrent();
      const id = await AsyncStorage.getItem(referenceKey(attemptId));
      return id ? resultOf(await wallet.getCoopExitRequest(id)) : { status: 'unknown' };
    },
  };
}
