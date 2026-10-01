// components/NwcPaymentApprover.tsx
//
// Registers the in-app confirmation that NWCService requires before paying an
// invoice requested over Nostr Wallet Connect. Rendered once at the app root.
// Refuses outright while the app lock is closed, so a payment can never be
// approved behind the lock screen; the NWC client can retry after unlocking.
import { useEffect } from 'react';
import { Alert } from 'react-native';
import NWCService, { NWCPaymentApprovalRequest } from '../services/NWCService';
import { isAppUnlocked } from '../services/appLockState';
import { formatBitcoinAmount } from '../utils/bitcoinUnits';

export function confirmNwcPayment(request: NWCPaymentApprovalRequest): Promise<boolean> {
  if (!isAppUnlocked()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const answer = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const amount = `${formatBitcoinAmount(request.amountSats, 'sats')} sats`;
    const memo = request.description ? `\n\n“${request.description}”` : '';
    Alert.alert(
      'Approve Wallet Connect payment?',
      `A connected app is requesting ${amount}.${memo}`,
      [
        { text: 'Decline', style: 'cancel', onPress: () => answer(false) },
        { text: 'Pay', style: 'destructive', onPress: () => answer(true) },
      ],
      // Android: tapping outside / back dismisses without paying.
      { cancelable: true, onDismiss: () => answer(false) },
    );
  });
}

export function NwcPaymentApprover() {
  useEffect(() => {
    const service = NWCService.getInstance();
    service.setPaymentApprover(confirmNwcPayment);
    return () => service.setPaymentApprover(null);
  }, []);
  return null;
}

export default NwcPaymentApprover;
