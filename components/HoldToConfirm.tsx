import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import { useAppTheme } from '../theme/ThemeProvider';
import { feedback } from '../utils/feedback';

interface HoldToConfirmProps {
  label: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  /** Identity of the reviewed transaction, including the quote and account. */
  confirmationKey?: string | number;
}

const HOLD_MS = 1200;
const ALTERNATIVE_LABEL = 'Confirm without holding';

export function HoldToConfirm({ label, onConfirm, disabled, loading, confirmationKey }: HoldToConfirmProps) {
  const t = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [submitting, setSubmitting] = useState(false);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const hold = useRef(false);
  const prompt = useRef<symbol | null>(null);
  const committed = useRef(false);
  const mounted = useRef(false);
  const busy = !!loading || submitting;
  const inactive = !!disabled || busy || needsStatusCheck;

  const stopHold = useCallback(() => {
    hold.current = false;
    animation.current?.stop();
    animation.current = null;
    progress.setValue(0);
  }, [progress]);

  const invalidate = useCallback(() => {
    stopHold();
    prompt.current = null;
  }, [stopHold]);

  // A refresh, new route or disabled state invalidates both confirmation paths.
  useLayoutEffect(() => invalidate, [confirmationKey, label, inactive, invalidate]);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState?.addEventListener?.('change', state => {
      if (state !== 'active') invalidate();
    });
    return () => {
      mounted.current = false;
      subscription?.remove();
    };
  }, [invalidate]);

  const startHold = () => {
    if (inactive || committed.current || prompt.current) return;
    hold.current = true;
    if (reduceMotion) return;
    animation.current = Animated.timing(progress, {
      toValue: 1,
      easing: fraction => fraction,
      duration: HOLD_MS,
      useNativeDriver: true,
    });
    animation.current.start();
  };

  const confirm = async () => {
    if (inactive || committed.current) return;
    committed.current = true;
    invalidate();
    setSubmitting(true);
    feedback.tap();
    try {
      await onConfirm();
      committed.current = false;
    } catch {
      // An unexpected rejection does not prove that the payment was unsent.
      if (mounted.current) setNeedsStatusCheck(true);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  const openConfirmation = () => {
    if (inactive || committed.current || prompt.current) return;
    stopHold();
    const token = Symbol();
    prompt.current = token;
    const close = () => {
      if (prompt.current === token) prompt.current = null;
    };
    Alert.alert('Confirm transaction', label, [
      { text: 'Cancel', style: 'cancel', onPress: close },
      { text: 'Confirm', onPress: () => { if (prompt.current === token) void confirm(); } },
    ], { cancelable: true, onDismiss: close });
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={needsStatusCheck ? 'Check Activity before trying again.' : label}
        accessibilityHint="Hold to confirm, or activate to open a confirmation dialog."
        accessibilityState={{ disabled: inactive, busy }}
        accessibilityActions={[{ name: 'activate', label: ALTERNATIVE_LABEL }]}
        onAccessibilityTap={openConfirmation}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'activate') openConfirmation();
        }}
        disabled={inactive}
        delayLongPress={HOLD_MS}
        pressRetentionOffset={0}
        onPressIn={startHold}
        onPressOut={stopHold}
        // Pressability owns the gesture. The progress animation never authorizes a payment.
        onLongPress={() => { if (hold.current) void confirm(); }}
        style={({ pressed }) => [styles.track, {
          borderRadius: t.borderRadius.lg,
          borderColor: inactive ? t.colors.border.medium : t.colors.primary[600],
          backgroundColor: inactive ? t.colors.surface.secondary : t.colors.primary[pressed && reduceMotion ? 100 : 50],
          padding: t.spacing[1], gap: t.spacing[2],
        }]}
      >
        {!reduceMotion && <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, {
            backgroundColor: t.dark ? t.colors.primary[900] : t.colors.primary[200],
            transformOrigin: 'left center',
            transform: [{ scaleX: progress }],
          }]}
        />}
        <View style={[styles.circle, { backgroundColor: inactive && !busy ? t.colors.surface.tertiary : t.colors.primary[500] }]}>
          {busy && !reduceMotion
            ? <ActivityIndicator size="small" color={t.colors.primary[950]} />
            : <Ionicons name={busy ? 'hourglass-outline' : 'finger-print-outline'} size={20} color={inactive && !busy ? t.colors.text.secondary : t.colors.primary[950]} />}
        </View>
        <Text style={{ flex: 1, color: t.colors.text.primary, paddingEnd: t.spacing[2], fontSize: t.typography.fontSize.base, fontWeight: '700' }}>
          {busy ? 'Processing…' : needsStatusCheck ? 'Check Activity before trying again.' : `Hold to ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive }}
        disabled={inactive}
        onPress={openConfirmation}
        style={[styles.alternative, { paddingHorizontal: t.spacing[2] }]}
      >
        <Text style={{ textAlign: 'center', color: inactive ? t.colors.text.disabled : t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>
          {ALTERNATIVE_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', minHeight: 54, alignItems: 'center', borderWidth: 1, overflow: 'hidden' },
  circle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  alternative: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
