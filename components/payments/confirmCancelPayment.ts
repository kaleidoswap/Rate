// components/payments/confirmCancelPayment.ts
//
// "Cancel payment" on a payment still pending or needing a check (Send's
// receipt, a long-press on its Activity row): one confirmation, then the
// honest outcome from cancelPendingPayment. When the payment is in flight and
// can't be cancelled, the result offers "Remove from Activity" instead.
import { Alert } from 'react-native';
import type { CancelResult } from '../../services/kaleidoPay/cancelPayment';

export const CANCEL_PAYMENT_TITLE = 'Cancel this payment?';
export const CANCEL_PAYMENT_MESSAGE =
  'We’ll first check with the provider where it is. If it never left, or the provider can still stop it, it’s cancelled. '
  + 'A payment already on its way can’t always be called back; you’ll see what happened.';
export const CANCEL_PAYMENT_ACTION = 'Cancel payment';

const RESULT_TITLE: Record<CancelResult['outcome'], string> = {
  cancelled: 'Payment cancelled',
  'not-sent': 'Payment not sent',
  completed: 'Payment went through',
  'in-flight': 'Can’t cancel this payment',
  gone: 'Nothing to cancel',
};

/** Asks first; `onConfirm` runs only on Cancel payment. */
export function confirmCancelPayment(onConfirm: () => void | Promise<void>): void {
  Alert.alert(CANCEL_PAYMENT_TITLE, CANCEL_PAYMENT_MESSAGE, [
    { text: 'Keep', style: 'cancel' },
    { text: CANCEL_PAYMENT_ACTION, style: 'destructive', onPress: () => onConfirm() },
  ]);
}

/** The outcome, with "Remove from Activity" when it is in flight and can't be cancelled. */
export function showCancelResult(result: CancelResult, onRemove?: () => void): void {
  const buttons: { text: string; style?: 'cancel' | 'destructive' | 'default'; onPress?: () => void }[] =
    result.outcome === 'in-flight' && onRemove
      ? [{ text: 'OK', style: 'cancel' }, { text: 'Remove from Activity', style: 'destructive', onPress: onRemove }]
      : [{ text: 'OK' }];
  Alert.alert(RESULT_TITLE[result.outcome], result.message, buttons);
}
