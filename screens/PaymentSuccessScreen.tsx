// screens/PaymentSuccessScreen.tsx
//
// The post-payment confirmation. Replaces the old `Alert.alert('Payment Sent!')`
// with a clean, full-screen success moment: an animated check (with a pulsing
// halo), the amount that left the wallet, a compact receipt, and a multi-modal
// success cue (haptic + chime via feedback.send()). Reusable across every send
// path (Lightning, on-chain, RGB, Spark, Arkade).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Clipboard,
  Share,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import { theme } from '../theme';
import { Button } from '../components';
import { NetworkIcon } from '../components/NetworkIcon';
import { feedback } from '../utils/feedback';
import { haptic } from '../utils/haptics';

export type PaymentType = 'lightning' | 'bitcoin' | 'rgb' | 'spark' | 'arkade' | 'boarding';

export interface PaymentSuccessParams {
  /** Display amount, already formatted in the unit below (e.g. "0.001", "10"). */
  amount: string;
  /** Unit/ticker label shown next to the amount ("BTC", "sats", "USDT"). */
  unit: string;
  /** Optional fiat estimate line, pre-formatted (e.g. "≈ $65.00"). */
  fiat?: string;
  /** Recipient address / invoice — truncated for display. */
  recipient: string;
  paymentType: PaymentType;
  /** `pending` means the transfer was accepted/submitted but not fully settled. */
  status?: 'confirmed' | 'pending';
  /** Optional network-fee line, pre-formatted (e.g. "2 sat/vB"). */
  fee?: string;
  /** Optional reference (txid / payment hash / preimage) with a copy affordance. */
  reference?: string;
  referenceLabel?: string;
}

interface Props {
  navigation: any;
  route: { params: PaymentSuccessParams };
}

const TYPE_META: Record<PaymentType, {
  label: string;
  sub: string;
  network: string;
  networkLabel: string;
}> = {
  lightning: { label: 'Payment Sent', sub: 'Paid over Lightning', network: 'lightning', networkLabel: 'Lightning' },
  bitcoin: { label: 'Payment Sent', sub: 'Broadcast on-chain', network: 'bitcoin', networkLabel: 'Bitcoin · on-chain' },
  rgb: { label: 'Asset Sent', sub: 'RGB asset transferred', network: 'rgb', networkLabel: 'RGB' },
  spark: { label: 'Payment Sent', sub: 'Transferred over Spark', network: 'spark', networkLabel: 'Spark' },
  arkade: { label: 'Payment Sent', sub: 'Transferred over Arkade', network: 'arkade', networkLabel: 'Arkade' },
  boarding: { label: 'Payment Submitted', sub: 'Arkade offboard is awaiting settlement', network: 'arkade', networkLabel: 'Arkade · on-chain' },
};

const truncate = (s: string): string =>
  s.length > 24 ? `${s.slice(0, 10)}…${s.slice(-10)}` : s;

export default function PaymentSuccessScreen({ navigation, route }: Props) {
  const { amount, unit, fiat, recipient, paymentType, status = 'confirmed', fee, reference, referenceLabel } = route.params;
  const baseMeta = TYPE_META[paymentType] ?? TYPE_META.lightning;
  const isPending = status === 'pending';
  const meta = isPending
    ? {
        ...baseMeta,
        label: paymentType === 'boarding' ? 'Withdrawal Submitted' : 'Payment Submitted',
        sub: paymentType === 'boarding' ? 'Awaiting on-chain settlement' : 'Awaiting network settlement',
      }
    : baseMeta;

  const checkAnim = useRef<LottieView>(null);
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const detailsY = useRef(new Animated.Value(24)).current;
  const detailsOpacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [copied, setCopied] = useState(false);

  // Stamp the moment the payment landed (app code — `new Date()` is fine here).
  const timeLabel = useMemo(
    () => new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    [],
  );

  useEffect(() => {
    // Confirmed payments get the full success cue. Pending offboard/settlement
    // flows use a lighter cue so they are not presented as final completion.
    if (isPending) {
      feedback.select();
    } else {
      feedback.send();
    }
    checkAnim.current?.play();

    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(detailsY, {
        toValue: 0,
        duration: 420,
        delay: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(detailsOpacity, {
        toValue: 1,
        duration: 420,
        delay: 240,
        useNativeDriver: true,
      }),
    ]).start();

    // Gentle, continuous halo pulse behind the check.
    Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  const handleDone = () => {
    feedback.tap();
    // Dismiss the Send/Success modals back to the dashboard.
    navigation.navigate('Dashboard');
  };

  const handleCopyReference = () => {
    if (!reference) return;
    Clipboard.setString(reference);
    void haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleShare = () => {
    feedback.tap();
    const lines = [
      `Sent ${amount} ${unit}${fiat ? ` (${fiat.replace('≈ ', '')})` : ''}`,
      `To: ${recipient}`,
      `Via: ${meta.networkLabel}`,
      reference ? `${referenceLabel || 'Reference'}: ${reference}` : undefined,
    ].filter(Boolean);
    void Share.share({ message: lines.join('\n') });
  };

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0] });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        {/* Animated success mark with a pulsing halo */}
        <Animated.View style={[styles.checkWrap, { opacity, transform: [{ scale }] }]}>
          <Animated.View
            style={[styles.pulseRing, { opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]}
          />
          <View style={styles.glow} />
          <LottieView
            ref={checkAnim}
            source={require('../assets/animations/success.json')}
            style={styles.lottie}
            autoPlay={false}
            loop={false}
          />
        </Animated.View>

        <Animated.View style={{ opacity, alignItems: 'center' }}>
          <Text style={styles.title}>{meta.label}</Text>
          <View style={styles.typeRow}>
            <Ionicons
              name={isPending ? 'time-outline' : 'checkmark-circle'}
              size={14}
              color={isPending ? theme.colors.warning[500] : theme.colors.success[500]}
            />
            <Text style={styles.typeSub}>{meta.sub}</Text>
          </View>
        </Animated.View>

        {/* Amount */}
        <Animated.View style={[styles.amountWrap, { opacity }]}>
          <Text style={styles.amount} allowFontScaling={false}>
            <Text style={styles.amountSign}>− </Text>
            {amount}
            <Text style={styles.unit}> {unit}</Text>
          </Text>
          {!!fiat && <Text style={styles.fiat}>{fiat}</Text>}
        </Animated.View>

        {/* Receipt card */}
        <Animated.View
          style={[styles.card, { opacity: detailsOpacity, transform: [{ translateY: detailsY }] }]}
        >
          <View style={styles.row}>
            <Text style={styles.rowLabel}>To</Text>
            <View style={styles.rowRight}>
              <NetworkIcon network={meta.network} size={16} />
              <Text style={styles.rowValueMono} numberOfLines={1}>{truncate(recipient)}</Text>
            </View>
          </View>

          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Network</Text>
            <Text style={styles.rowValue}>{meta.networkLabel}</Text>
          </View>

          {isPending && (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Status</Text>
                <Text style={styles.rowValue}>Pending settlement</Text>
              </View>
            </>
          )}

          {!!fee && (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Network fee</Text>
                <Text style={styles.rowValue}>{fee}</Text>
              </View>
            </>
          )}

          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>When</Text>
            <Text style={styles.rowValue}>{timeLabel}</Text>
          </View>

          {!!reference && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.row} onPress={handleCopyReference} activeOpacity={0.7}>
                <Text style={styles.rowLabel}>{referenceLabel || 'Reference'}</Text>
                <View style={styles.rowRight}>
                  <Text style={styles.rowValueMono} numberOfLines={1}>{truncate(reference)}</Text>
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={16}
                    color={copied ? theme.colors.success[500] : theme.colors.text.secondary}
                  />
                </View>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </View>

      <Animated.View style={[styles.footer, { opacity: detailsOpacity }]}>
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
          <Ionicons name="share-outline" size={18} color={theme.colors.text.secondary} />
          <Text style={styles.shareText}>Share receipt</Text>
        </TouchableOpacity>
        <Button title="Done" variant="primary" onPress={handleDone} fullWidth />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  checkWrap: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[5],
  },
  pulseRing: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: theme.colors.success[500],
  },
  glow: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: theme.colors.success[500],
    opacity: 0.12,
  },
  lottie: {
    width: 132,
    height: 132,
  },
  title: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '800',
    color: theme.colors.text.primary,
    textAlign: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  typeSub: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  amountWrap: {
    alignItems: 'center',
    marginTop: theme.spacing[5],
    marginBottom: theme.spacing[6],
  },
  amount: {
    fontSize: 44,
    fontWeight: '800',
    color: theme.colors.text.primary,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  amountSign: {
    fontSize: 26,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
  },
  unit: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.secondary,
  },
  fiat: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[2],
  },
  card: {
    width: '100%',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius['2xl'],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    paddingHorizontal: theme.spacing[5],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[3] + 2,
    gap: theme.spacing[4],
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  rowLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    fontWeight: '600',
  },
  rowValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  rowValueMono: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border.light,
  },
  footer: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[4],
    paddingTop: theme.spacing[2],
    gap: theme.spacing[3],
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  shareText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
});
