// components/PaymentConfirmationModal.tsx
//
// The one confirm sheet for money-moving actions, used by the assistant chat,
// the voice overlay (inline, inside its own modal) and the Nostr chat.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
  Animated,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { CopyButton } from './CopyButton';
import { haptic } from '../utils/haptics';
import SecurityService from '../services/SecurityService';
import { authorizeSpend } from '../services/spendAuth';
import { secondsLeft, formatSats, type ConfirmReadback } from '../services/aiConfirm';

export interface PaymentDetails {
  type: 'lightning_address' | 'lightning_invoice' | 'nostr_contact';
  recipient: string;
  amount: number;
  description?: string;
  recipientName?: string;
  recipientAvatar?: string;
  lightningAddress?: string;
  isNostrContact?: boolean;
  /** BTC/USD price used for the fiat estimate (0/undefined → hide the USD line). */
  priceUsd?: number;
}

interface Props {
  visible: boolean;
  readback?: ConfirmReadback | null;
  /** Older callers pass the payment fields directly. */
  paymentDetails?: PaymentDetails | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** The approved action is running. */
  loading?: boolean;
  /** Shown instead of the hold button while the sheet checks something (e.g. a re-quote). */
  busyLabel?: string | null;
  /** Ask for biometrics/PIN after the hold. */
  requireAuth?: boolean;
  priceUsd?: number;
  /** Render without a native Modal (when already inside one). */
  inline?: boolean;
}

export const HOLD_TO_CONFIRM_MS = 1200;

export function readbackFromPaymentDetails(d: PaymentDetails): ConfirmReadback {
  const rows = [
    { label: d.type === 'lightning_address' ? 'Lightning address' : d.type === 'nostr_contact' ? 'Nostr contact' : 'Lightning invoice', value: d.lightningAddress || d.recipient, copyable: true },
    ...(d.description ? [{ label: 'Note', value: d.description }] : []),
  ];
  return {
    kind: 'payment',
    title: 'Confirm payment',
    cta: 'Send',
    amount: d.amount > 0 ? formatSats(d.amount) : undefined,
    amountSats: d.amount > 0 ? d.amount : undefined,
    recipientName: d.recipientName,
    rows,
    spoken: '',
  };
}

const middleTruncate = (s: string, keep = 14) => (s.length > keep * 2 + 3 ? `${s.slice(0, keep)}…${s.slice(-keep)}` : s);

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = secondsLeft(expiresAt, now) ?? 0;
  return (
    <View style={styles.countdown} accessibilityLiveRegion="polite">
      <Ionicons name="time-outline" size={14} color={left > 10 ? theme.colors.text.secondary : theme.colors.warning[500]} />
      <Text style={[styles.countdownText, left <= 10 && { color: theme.colors.warning[500] }]}>
        {left > 0 ? `Quote expires in ${left} s` : 'Quote expired: approving fetches a fresh price first'}
      </Text>
    </View>
  );
}

function HoldButton({ label, onComplete, disabled }: { label: string; onComplete: () => void; disabled?: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const start = () => {
    if (disabled) return;
    void haptic.light().catch(() => {});
    anim.current = Animated.timing(progress, { toValue: 1, duration: HOLD_TO_CONFIRM_MS, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      if (finished) {
        void haptic.heavy().catch(() => {});
        progress.setValue(0);
        onComplete();
      }
    });
  };
  const cancel = () => {
    anim.current?.stop();
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };
  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <Pressable
      onPressIn={start}
      onPressOut={cancel}
      disabled={disabled}
      style={[styles.holdButton, disabled && styles.buttonDisabled]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Hold to confirm`}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate' && !disabled) onComplete(); }}
      testID="hold-to-confirm"
    >
      <Animated.View style={[styles.holdFill, { width }]} />
      <Ionicons name="finger-print" size={18} color="white" />
      <Text style={styles.confirmText}>Hold to {label.toLowerCase()}</Text>
    </Pressable>
  );
}

function SheetBody({
  readback,
  onConfirm,
  onCancel,
  loading,
  busyLabel,
  requireAuth,
  priceUsd,
}: Required<Pick<Props, 'onConfirm' | 'onCancel'>> & {
  readback: ConfirmReadback;
  loading: boolean;
  busyLabel?: string | null;
  requireAuth?: boolean;
  priceUsd?: number;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [askPin, setAskPin] = useState(false);
  const [pin, setPin] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  useEffect(() => {
    setAskPin(false);
    setPin('');
    setAuthError(null);
  }, [readback]);

  const approve = async () => {
    setAuthError(null);
    if (!requireAuth) return onConfirm();
    setAuthorizing(true);
    try {
      const res = await authorizeSpend(`Approve: ${readback.title.toLowerCase()}`);
      if (res === 'approved') onConfirm();
      else if (res === 'pin') setAskPin(true);
      else setAuthError('Not approved. Hold again to retry.');
    } finally {
      setAuthorizing(false);
    }
  };

  const submitPin = async () => {
    setAuthorizing(true);
    try {
      if (await SecurityService.getInstance().verifyPin(pin)) {
        setAskPin(false);
        onConfirm();
      } else {
        setAuthError('Wrong PIN.');
      }
    } finally {
      setPin('');
      setAuthorizing(false);
    }
  };

  const fiat =
    readback.amountSats && (priceUsd ?? 0) > 0
      ? `≈ $${((readback.amountSats / 1e8) * (priceUsd as number)).toFixed(2)} USD`
      : undefined;
  const busy = loading || !!busyLabel || authorizing;

  return (
    <View style={styles.modal}>
      <View style={styles.handleBar} />
      <View style={styles.headerContent}>
        <View style={styles.iconCircle}>
          <Ionicons name={readback.kind === 'swap' ? 'swap-horizontal' : 'shield-checkmark'} size={22} color={theme.colors.primary[500]} />
        </View>
        <Text style={styles.title}>{readback.title}</Text>
        {!!readback.amount && <Text style={styles.amount} testID="confirm-amount">{readback.amount}</Text>}
        {!!fiat && <Text style={styles.amountUsd}>{fiat}</Text>}
        {!!readback.recipientName && <Text style={styles.recipient}>to {readback.recipientName}</Text>}
      </View>

      <ScrollView style={styles.rows} contentContainerStyle={{ gap: theme.spacing[3] }}>
        {readback.rows.map((r) => {
          const open = !!expanded[r.label];
          return (
            <View key={r.label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{r.label}</Text>
              <View style={styles.detailValueWrap}>
                {r.copyable ? (
                  <>
                    <Pressable onPress={() => setExpanded((e) => ({ ...e, [r.label]: !open }))} accessibilityRole="button" accessibilityLabel={open ? `Collapse ${r.label}` : `Show full ${r.label}`} style={{ flex: 1 }}>
                      <Text style={[styles.detailValue, styles.mono]} selectable>{open ? r.value : middleTruncate(r.value)}</Text>
                    </Pressable>
                    <CopyButton value={r.value} size={16} />
                  </>
                ) : (
                  <Text style={styles.detailValue}>{r.value}</Text>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {readback.expiresAt != null && <Countdown expiresAt={readback.expiresAt} />}

      {!!readback.warning && (
        <View style={[styles.notice, styles.warning]}>
          <Ionicons name="warning-outline" size={16} color={theme.colors.warning[500]} />
          <Text style={[styles.noticeText, { color: theme.colors.warning[500] }]}>{readback.warning}</Text>
        </View>
      )}

      <View style={styles.notice}>
        <Ionicons name="information-circle" size={16} color={theme.colors.primary[500]} />
        <Text style={styles.noticeText}>
          This can't be undone. Check the details{requireAuth ? '; you will also confirm with biometrics or your PIN' : ''}.
        </Text>
      </View>

      {askPin && (
        <View style={styles.pinRow}>
          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={setPin}
            placeholder="Wallet PIN"
            placeholderTextColor={theme.colors.text.tertiary}
            secureTextEntry
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={submitPin}
            accessibilityLabel="Wallet PIN"
          />
          <TouchableOpacity style={styles.pinSubmit} onPress={submitPin} disabled={!pin || authorizing}>
            <Text style={styles.confirmText}>OK</Text>
          </TouchableOpacity>
        </View>
      )}
      {!!authError && <Text style={styles.authError}>{authError}</Text>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={loading} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        {busy ? (
          <View style={[styles.holdButton, styles.buttonDisabled]} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color="white" />
            <Text style={styles.confirmText}>{loading ? 'Processing…' : busyLabel || 'Checking…'}</Text>
          </View>
        ) : (
          <HoldButton label={readback.cta} onComplete={approve} disabled={askPin} />
        )}
      </View>
    </View>
  );
}

export default function PaymentConfirmationModal({
  visible,
  readback,
  paymentDetails,
  onConfirm,
  onCancel,
  loading = false,
  busyLabel,
  requireAuth,
  priceUsd,
  inline,
}: Props) {
  const r = readback ?? (paymentDetails ? readbackFromPaymentDetails(paymentDetails) : null);
  useEffect(() => {
    if (visible) void haptic.warning().catch(() => {});
  }, [visible]);
  if (!r || !visible) return null;

  const body = (
    <SheetBody
      readback={r}
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      busyLabel={busyLabel}
      requireAuth={requireAuth}
      priceUsd={priceUsd ?? paymentDetails?.priceUsd}
    />
  );
  if (inline) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.overlay]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={loading ? undefined : onCancel} accessibilityLabel="Dismiss" />
        {body}
      </View>
    );
  }
  return (
    <Modal visible transparent animationType="slide" onRequestClose={loading ? () => {} : onCancel}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={loading ? undefined : onCancel} accessibilityLabel="Dismiss" />
        {body}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.colors.background.backdrop,
  },
  modal: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: 36,
    maxHeight: '90%',
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.gray[300],
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing[4],
  },
  headerContent: { alignItems: 'center', marginBottom: theme.spacing[4] },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
    marginBottom: theme.spacing[2],
  },
  title: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.text.primary },
  amount: {
    fontSize: theme.typography.fontSize['3xl'],
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    marginTop: theme.spacing[2],
    fontVariant: ['tabular-nums'],
  },
  amountUsd: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, marginTop: theme.spacing[1] },
  recipient: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, marginTop: theme.spacing[1], fontWeight: '600' },
  rows: { flexGrow: 0, marginBottom: theme.spacing[3] },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[3] },
  detailLabel: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, width: 110 },
  detailValueWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
  detailValue: { flex: 1, fontSize: theme.typography.fontSize.sm, color: theme.colors.text.primary, textAlign: 'right' },
  mono: { fontFamily: 'Courier' },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: theme.spacing[3] },
  countdownText: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface.secondary,
    borderRadius: theme.borderRadius.md,
  },
  warning: { borderWidth: 1, borderColor: theme.colors.warning[500] },
  noticeText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, flex: 1 },
  pinRow: { flexDirection: 'row', gap: theme.spacing[2], marginBottom: theme.spacing[3] },
  pinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.text.primary,
  },
  pinSubmit: {
    paddingHorizontal: theme.spacing[4],
    justifyContent: 'center',
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primary[500],
  },
  authError: { color: theme.colors.error[500], fontSize: theme.typography.fontSize.sm, textAlign: 'center', marginBottom: theme.spacing[2] },
  actions: { flexDirection: 'row', gap: theme.spacing[3] },
  cancelButton: {
    flex: 1,
    paddingVertical: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface.secondary,
    alignItems: 'center',
  },
  cancelText: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.secondary },
  holdButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primary[600],
    overflow: 'hidden',
  },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.colors.primary[400] },
  confirmText: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.semibold, color: 'white' },
  buttonDisabled: { opacity: 0.7 },
});
