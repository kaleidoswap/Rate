// components/payments/confirmRemovePayment.ts
//
// The one confirmation shown before a payment still pending or needing a check
// is removed from Activity (Send's receipt, a long-press on its Activity row).
import { Alert } from 'react-native';

export const REMOVE_PAYMENT_TITLE = 'Remove this payment?';
export const REMOVE_PAYMENT_MESSAGE =
  'This only removes the record from Activity on this phone. It does not cancel the payment or move any funds: '
  + 'if it went through, the money was sent. Check your balance or ask the recipient before paying again.';
export const REMOVE_PAYMENT_ACTION = 'Remove';

/** Asks first; `onConfirm` runs only on Remove. */
export function confirmRemovePayment(onConfirm: () => void | Promise<void>): void {
  Alert.alert(REMOVE_PAYMENT_TITLE, REMOVE_PAYMENT_MESSAGE, [
    { text: 'Cancel', style: 'cancel' },
    { text: REMOVE_PAYMENT_ACTION, style: 'destructive', onPress: () => onConfirm() },
  ]);
}
