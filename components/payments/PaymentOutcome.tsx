import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Animated, { ZoomIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { motion } from '../../theme';
import { AmountText } from '../AmountText';
import { awaitingOnchainConfirmation, paymentPresentation } from '../../utils/payment-presentation';
import { unresolvedAttempt, type PaymentAttempt } from '../../services/kaleidoPay/attempts';

/** A pulsing ring around the status icon while the payment is being checked. */
function PulseRing({ color, active }: { color: string; active: boolean }) {
  const t = useAppTheme();
  if (!active) return null;
  return (
    <Animated.View
      entering={ZoomIn.springify().damping(motion.springSnappy.damping)}
      style={{
        position: 'absolute', width: 80, height: 80, borderRadius: 40,
        borderWidth: 2, borderColor: color + '40',
        alignItems: 'center', justifyContent: 'center',
      }}
    />
  );
}

/** One row of the summary card: label on the left, value on the right. */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const t = useAppTheme();
  return (
    <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] }}>
      <Text style={{ flex: 1, color: t.colors.text.tertiary, fontSize: t.typography.fontSize.sm }}>{label}</Text>
      <AmountText selectable style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.sm, fontWeight: '600', ...(mono ? { fontFamily: t.typography.fontFamily.mono } : {}) }}>{value}</AmountText>
    </Animated.View>
  );
}

/** Shared receipt presentation. No wallet access, polling or payment execution. */
export function PaymentOutcome({ attempt: a, busy = false, statusChecking = false, statusTimedOut = false, error = '', demo = false, expanded, onExpandedChange }: {
  attempt: PaymentAttempt; busy?: boolean; statusChecking?: boolean; statusTimedOut?: boolean; error?: string; demo?: boolean;
  expanded?: boolean; onExpandedChange?: (value: boolean) => void;
}) {
  const t = useAppTheme();
  const done = a.status === 'completed';
  const chainWaiting = awaitingOnchainConfirmation(a);
  const presentation = paymentPresentation(a);
  const refunded = a.status === 'failed' && a.resolution === 'refunded';
  const failed = a.status === 'failed';
  const pending = a.status === 'pending' || a.status === 'unknown';
  const checking = busy || statusChecking || (a.status === 'pending' && !statusTimedOut);

  const tone = (done && !chainWaiting) || refunded ? t.colors.primary[500] : failed ? t.colors.error[500] : t.colors.warning[500];
  const iconName = done && !chainWaiting ? 'checkmark' : refunded ? 'return-down-back-outline' : failed ? 'close' : chainWaiting ? 'cube-outline' : 'arrow-up';
  const title = done ? presentation.title : failed ? presentation.title : busy && !statusChecking ? 'Sending' : statusTimedOut && a.sourceId !== 'rgb-asset' ? 'Taking longer' : presentation.title;

  // Show the key info rows (always visible, not behind a toggle).
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (a.recipientName) rows.push({ label: 'To', value: a.recipientName });
  if (a.accountName || a.provider) rows.push({ label: 'From', value: a.accountName || a.provider });
  if (a.feeDisplay) rows.push({ label: 'Fee', value: a.feeDisplay });
  if (a.total) rows.push({ label: 'Total', value: a.total });

  // A small elapsed timer while pending.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1);
    return () => clearInterval(timer);
  }, [pending, a.id]);
  const elapsedText = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`;

  return <View style={{ gap: t.spacing[5], paddingTop: t.spacing[4] }}>
    {/* Status hero: animated icon, pulse ring, title, amount, recipient. */}
    <View style={{ alignItems: 'center', gap: t.spacing[2] }}>
      <Animated.View
        key={`${a.status}-${a.onchainConfirmed ?? false}`}
        entering={ZoomIn.springify().damping(motion.springSnappy.damping)}
        style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: tone + '1A' }}
      >
        {checking
          ? <ActivityIndicator accessibilityLabel="Checking payment" color={tone} size="large" />
          : <Ionicons name={iconName as any} size={32} color={tone} />}
      </Animated.View>
      {pending && <PulseRing color={tone} active={checking} />}
      <Text
        accessibilityRole="header"
        style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '700', textAlign: 'center' }}>
        {title}
      </Text>
      <AmountText style={{ fontSize: t.typography.fontSize['2xl'], fontWeight: '700', color: t.colors.text.primary }}>
        {a.recipient}
      </AmountText>
      {!!a.recipientName && (
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }} numberOfLines={1} ellipsizeMode="middle">
          {a.recipientName}
        </Text>
      )}
      {pending && (
        <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontVariant: ['tabular-nums'] }}>
          {elapsedText}
        </Text>
      )}
    </View>

    {/* Status detail: one sentence, animated in. */}
    {/* Status detail: one sentence, animated in. */}
    <Text
      accessibilityLiveRegion="polite"
      style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm, textAlign: 'center', paddingHorizontal: t.spacing[4] }}>
      {presentation.detail}
    </Text>
    {statusTimedOut && a.sourceId === 'rgb-asset' && unresolvedAttempt(a) && (
      <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, textAlign: 'center' }}>
        Automatic checks paused. Tap Verify payment to check again.
      </Text>
    )}

    {demo && done && <Text style={{ color: t.colors.warning[500], fontSize: t.typography.fontSize.sm, textAlign: 'center' }}>Simulated in this demo build. No funds moved.</Text>}

    {/* Key details card: always visible, no toggle needed. */}
    {rows.length > 0 && (
      <Animated.View entering={FadeInDown.delay(motion.stagger * 4).duration(motion.duration.base)}
        style={{ gap: t.spacing[2], paddingHorizontal: t.spacing[5], paddingVertical: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light }}>
        {rows.map((r) => <InfoRow key={r.label} {...r} />)}
      </Animated.View>
    )}

    {/* Reference: shown inline, not behind a toggle. */}
    {!!a.reference && (
      <Animated.View entering={FadeInDown.delay(motion.stagger * 5).duration(motion.duration.base)} style={{ alignItems: 'center', paddingHorizontal: t.spacing[5] }}>
        <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontFamily: t.typography.fontFamily.mono, textAlign: 'center' }} numberOfLines={1} selectable>
          {a.reference}
        </Text>
      </Animated.View>
    )}

    {/* Error, if any. */}
    {!!error && error !== a.detail && (
      <Text
        accessibilityRole="alert"
        style={{ color: t.colors.error[500], fontSize: t.typography.fontSize.sm, textAlign: 'center', paddingHorizontal: t.spacing[4] }}>
        {error}
      </Text>
    )}
  </View>;
}
