// services/kaleidoPay/cancelPayment.ts
//
// "Cancel payment" on a payment still pending or needing a check. It never
// guesses: it first asks the provider where the payment really is, then
//   • completed  → shown as completed (it went through; nothing to cancel)
//   • failed     → marked failed (the provider says it was not paid)
//   • never left this phone (no execution claim) → marked failed
//   • the rail can cancel (an RGB transfer the recipient has not accepted,
//     or an account with its own `cancel`) → cancelled, marked failed only
//     once the provider confirms it
//   • otherwise it is in flight and can't be called back: says so, and the
//     caller offers "Remove from Activity" instead.
// Funds are never described as returned unless the provider confirmed it.

import { isOnchainPayment } from '../../utils/payment-presentation';
import { loadPaymentAttempt, unresolvedAttempt, updatePaymentAttempt, type PaymentAttempt } from './attempts';
import type { PaymentResult } from './index';
import { updateContactEventStatus } from '../contactHistory';
import type { RgbTransfer } from '../../utils/rgb-wallet';

export type CancelOutcome =
  /** The provider cancelled it. */
  | 'cancelled'
  /** It never left this phone, or the provider reports it failed. */
  | 'not-sent'
  /** It actually went through. */
  | 'completed'
  /** It is on its way and this rail can't call it back (or the provider could not be reached). */
  | 'in-flight'
  /** Already settled, removed or missing: nothing to cancel. */
  | 'gone';

export type PaymentRailKind = 'lightning' | 'onchain' | 'rgb-transfer' | 'offchain';

export interface CancelResult {
  outcome: CancelOutcome;
  /** One honest sentence for the user. */
  message: string;
  /** The saved record after the check, when it changed or was read. */
  attempt?: PaymentAttempt;
}

export interface CancelDeps {
  prepare: () => Promise<void>;
  handedOver: (sourceId: string, attemptId: string) => Promise<boolean>;
  status: (sourceId: string, attemptId: string) => Promise<PaymentResult>;
  /** The account's own cancel (`unknown` when it has none). */
  cancel: (sourceId: string, attemptId: string) => Promise<PaymentResult>;
  /** The RGB account's on-chain transfers, to find and fail an RGB send by its txid. */
  rgb: () => RgbCancelPort | null;
}

export interface RgbCancelPort {
  findOutgoing: (txid: string) => Promise<Pick<RgbTransfer, 'status' | 'batchTransferIdx'> | undefined>;
  fail: (batchTransferIdx: number) => Promise<boolean>;
}

/** How a payment moves, for what cancelling can mean on it. */
export function paymentRailKind(a: Pick<PaymentAttempt, 'sourceId' | 'destinationRail'>): PaymentRailKind {
  if (a.sourceId === 'rgb-asset') return 'rgb-transfer';
  if (isOnchainPayment(a as PaymentAttempt)) return 'onchain';
  const rail = a.destinationRail?.split(':')[0];
  if (rail === 'ln' || rail === 'rgb-ln' || ['spark-ln', 'rgb-ln', 'bark'].includes(a.sourceId)) return 'lightning';
  return 'offchain';
}

/** Why a payment in flight can't be cancelled, per rail. No promise about funds. */
export function inFlightMessage(a: Pick<PaymentAttempt, 'sourceId' | 'destinationRail' | 'provider'>): string {
  const provider = a.provider || 'the provider';
  switch (paymentRailKind(a)) {
    case 'lightning':
      return `This Lightning payment was handed to ${provider}, and a Lightning payment can’t be called back by the sender. If it can’t reach the recipient it fails on its own and then shows as failed here.`;
    case 'onchain':
      return `This Bitcoin payment was handed to ${provider}. Once a transaction is broadcast, this wallet can’t replace or cancel it: it confirms or drops on its own.`;
    case 'rgb-transfer':
      return 'This RGB transfer is past the point where it can be cancelled (the recipient accepted it, or it couldn’t be found). It completes once its transaction confirms.';
    default:
      return `${a.provider || 'The provider'} doesn’t offer a way to cancel a payment once it is sent. Its status updates here when the provider reports it.`;
  }
}

function defaultDeps(): CancelDeps {
  // Loaded lazily: the protocol layer is heavy and only needed when the user cancels.
  const pay = require('./index') as typeof import('./index');
  return {
    prepare: () => pay.prepareKaleidoPay(),
    handedOver: pay.paymentHandedOver,
    status: pay.checkPaymentStatus,
    cancel: pay.cancelPaymentWithProvider,
    rgb: () => {
      const { rgbAccountAdapter } = require('../protocols') as typeof import('../protocols');
      const wallet = require('../rgbWallet') as typeof import('../rgbWallet');
      const { rgbWalletSupport } = require('../../utils/rgb-wallet') as typeof import('../../utils/rgb-wallet');
      const adapter: any = rgbAccountAdapter();
      const support = rgbWalletSupport(adapter);
      if (!support.listTransfers) return null;
      return {
        async findOutgoing(txid) {
          const assets: any[] = (await adapter.listAssets?.()) ?? [];
          for (const asset of assets) {
            if (!asset?.id || asset.id === 'BTC') continue;
            const found = (await wallet.listRgbTransfers(adapter, asset.id)).find(t => t.direction === 'outgoing' && t.txid === txid);
            if (found) return found;
          }
          return undefined;
        },
        fail: (idx) => support.cancelTransfer ? wallet.cancelRgbTransfer(adapter, idx) : Promise.resolve(false),
      };
    },
  };
}

/** An RGB send, read from the RGB account and cancelled when the recipient has not accepted it yet. */
async function cancelRgbSend(port: RgbCancelPort | null, txid: string | undefined): Promise<PaymentResult & { tried?: boolean }> {
  if (!port || !txid) return { status: 'unknown' };
  const transfer = await port.findOutgoing(txid);
  if (!transfer) return { status: 'unknown' };
  if (transfer.status === 'settled') return { status: 'completed', reference: txid };
  if (transfer.status === 'failed') return { status: 'failed', reference: txid };
  if (transfer.status !== 'waiting-counterparty' || transfer.batchTransferIdx == null) return { status: 'pending', reference: txid };
  const failed = await port.fail(transfer.batchTransferIdx);
  return failed ? { status: 'failed', reference: txid, tried: true } : { status: 'pending', reference: txid, tried: true };
}

async function settle(walletId: number, attempt: PaymentAttempt, result: PaymentResult, detail?: string): Promise<PaymentAttempt> {
  const updated: PaymentAttempt = {
    ...attempt, status: result.status, reference: result.reference ?? attempt.reference,
    ...(detail ? { detail } : {}), lastCheckedAt: Date.now(), checkFailed: false,
  };
  await updatePaymentAttempt(walletId, updated);
  await updateContactEventStatus(walletId, attempt.id, updated.status, updated.reference).catch(() => {});
  return updated;
}

/**
 * Checks a payment with its provider and cancels it where the rail allows (see the file
 * header). Only the saved record changes, and only to what the provider reported.
 */
export async function cancelPendingPayment(walletId: number, attemptId: string, deps: CancelDeps = defaultDeps()): Promise<CancelResult> {
  const attempt = await loadPaymentAttempt(walletId, attemptId);
  if (!attempt) return { outcome: 'gone', message: 'This payment is no longer in Activity.' };
  if (!unresolvedAttempt(attempt)) {
    return attempt.status === 'completed'
      ? { outcome: 'completed', message: 'This payment already went through.', attempt }
      : { outcome: 'gone', message: attempt.status === 'failed' ? 'This payment is already marked as failed.' : 'This payment is no longer in Activity.', attempt };
  }

  // Never handed to the provider: nothing left this phone.
  if (!await deps.handedOver(attempt.sourceId, attempt.id).catch(() => true)) {
    const updated = await settle(walletId, attempt, { status: 'failed' }, 'Cancelled before it was sent.');
    return { outcome: 'not-sent', message: 'This payment never left your wallet. It is now marked as failed and nothing was paid.', attempt: updated };
  }

  await deps.prepare().catch(() => undefined);
  const checked = await deps.status(attempt.sourceId, attempt.id).catch((): PaymentResult => ({ status: 'unknown' }));
  if (checked.status === 'completed') {
    const updated = await settle(walletId, attempt, checked);
    return { outcome: 'completed', message: 'The provider confirms this payment went through, so it can’t be cancelled. It now shows as completed.', attempt: updated };
  }
  if (checked.status === 'failed') {
    const updated = await settle(walletId, attempt, checked);
    return { outcome: 'not-sent', message: 'The provider reports this payment failed, so the recipient was not paid. It is now marked as failed.', attempt: updated };
  }

  // Ask the rail to cancel it, where it can.
  const reference = checked.reference ?? attempt.reference;
  const rgb = paymentRailKind(attempt) === 'rgb-transfer'
    ? await Promise.resolve().then(() => cancelRgbSend(deps.rgb(), reference)).catch((): PaymentResult & { tried?: boolean } => ({ status: 'unknown' }))
    : undefined;
  const cancelled = rgb && rgb.status !== 'unknown' ? rgb : await deps.cancel(attempt.sourceId, attempt.id).catch((): PaymentResult => ({ status: 'unknown' }));
  if (cancelled.status === 'failed') {
    const tried = rgb ? !!rgb.tried : true;
    const updated = await settle(walletId, attempt, cancelled, tried ? 'Cancelled at your request.' : undefined);
    return tried
      ? { outcome: 'cancelled', message: 'The payment is cancelled and the recipient will not receive it. It is now marked as failed.', attempt: updated }
      : { outcome: 'not-sent', message: 'The provider reports this payment failed, so the recipient was not paid. It is now marked as failed.', attempt: updated };
  }
  if (cancelled.status === 'completed') {
    const updated = await settle(walletId, attempt, cancelled);
    return { outcome: 'completed', message: 'The provider confirms this payment went through, so it can’t be cancelled. It now shows as completed.', attempt: updated };
  }

  const unreachable = checked.status === 'unknown' && cancelled.status === 'unknown';
  return {
    outcome: 'in-flight',
    message: `${unreachable ? `${attempt.provider || 'The provider'} couldn’t confirm where this payment is, so nothing was cancelled. ` : ''}${inFlightMessage(attempt)}`,
    attempt,
  };
}
