import React, { useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { motion } from '../../theme';
import { Button } from '../Button';
import { AmountText } from '../AmountText';
import { PaymentReceiptDetails } from '../PaymentReceiptDetails';
import { awaitingOnchainConfirmation, paymentPresentation } from '../../utils/payment-presentation';
import { unresolvedAttempt, type PaymentAttempt } from '../../services/kaleidoPay/attempts';

/** Shared receipt presentation. No wallet access, polling or payment execution. */
export function PaymentOutcome({ attempt: a, busy = false, statusChecking = false, statusTimedOut = false, error = '', demo = false, expanded, onExpandedChange }: {
  attempt: PaymentAttempt; busy?: boolean; statusChecking?: boolean; statusTimedOut?: boolean; error?: string; demo?: boolean;
  expanded?: boolean; onExpandedChange?: (value: boolean) => void;
}) {
  const t = useAppTheme();
  const [localExpanded, setLocalExpanded] = useState(false);
  const receiptExpanded = expanded ?? localExpanded;
  const setReceiptExpanded = onExpandedChange ?? setLocalExpanded;
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const muted = { ...text, color: t.colors.text.secondary };
  const small = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs };
    const done = a.status === 'completed';
    const chainWaiting = awaitingOnchainConfirmation(a);
    const presentation = paymentPresentation(a);
    const failed = a.status === 'failed';
    const tone = done && !chainWaiting ? t.colors.primary[500] : failed ? t.colors.error[500] : t.colors.warning[500];
    const title = done ? presentation.title : failed ? 'Payment failed' : busy && !statusChecking ? 'Sending payment' : statusTimedOut && a.sourceId !== 'rgb-asset' ? 'Confirmation is taking longer' : presentation.title;
  return <View style={{ gap: t.spacing[4] }}>
      <View style={{ alignItems: 'center', gap: t.spacing[2], paddingTop: t.spacing[6] }}>
        <Animated.View key={a.onchainConfirmed ? 'chain-confirmed' : done ? 'completed' : failed ? 'failed' : 'checking'} entering={ZoomIn.springify().damping(motion.springSnappy.damping)}
          style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: tone + '26' }}>
          {busy || statusChecking || (a.status === 'pending' && !statusTimedOut) ? <ActivityIndicator accessibilityLabel="Checking payment automatically" color={tone} /> : <Ionicons name={chainWaiting ? 'time-outline' : done ? 'checkmark' : failed ? 'close' : 'time-outline'} size={40} color={tone} />}
        </Animated.View>
        <Text accessibilityRole="header" style={{ ...muted }}>{title}</Text>
        <AmountText style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '700' }}>{a.recipient}</AmountText>
        {!!a.recipientName && <Text style={muted} numberOfLines={2} ellipsizeMode="middle">{done ? 'sent to' : 'to'} {a.recipientName}</Text>}
      </View>
      {demo && done && <Text style={{ ...muted, color: t.colors.warning[500], textAlign: 'center' }}>Simulated in this demo build. No funds moved.</Text>}
      <Button title={receiptExpanded ? 'Hide details' : 'Payment details'} variant="ghost" onPress={() => setReceiptExpanded(!receiptExpanded)} />
      {receiptExpanded && <>
      <PaymentReceiptDetails quoted={a.sourceId !== 'rgb-asset'} details={{ amount: a.recipient, recipient: a.recipientName, fees: a.feeDisplay, total: a.total, account: a.accountName || a.provider, reference: a.reference, createdAt: a.createdAt }} />
      <Text style={small}>{a.sourceId === 'rgb-asset' ? 'Bitcoin network fees are estimated. The asset amount is sent directly to the recipient.' : 'Fees and total are from the quote you approved. Final fees may differ where the provider supplies an estimate.'}</Text>
      {!!a.detail && a.detail !== presentation.detail && <Text style={small}>{a.detail}</Text>}
      </>}
      <Text accessibilityLiveRegion="polite" style={{ ...muted, textAlign: 'center' }}>{unresolvedAttempt(a) ? (statusTimedOut && a.sourceId !== 'rgb-asset' ? 'No final result yet. Check again later; do not send it again.' : presentation.detail) : presentation.detail}</Text>
      {statusTimedOut && a.sourceId === 'rgb-asset' && unresolvedAttempt(a) && <Text style={{ ...small, textAlign: 'center' }}>Automatic checks paused. Tap Verify payment to check again.</Text>}
      {!!a.lastCheckedAt && unresolvedAttempt(a) && receiptExpanded && <Text style={small}>Last verification attempt: {new Date(a.lastCheckedAt).toLocaleTimeString()}{a.status === 'unknown' && !a.reference ? ' · Receipt unavailable' : a.checkFailed ? ' · Connection unavailable' : ''}</Text>}
      {!!error && error !== a.detail && <Text accessibilityRole="alert" style={small}>{error}</Text>}
  </View>;
}
