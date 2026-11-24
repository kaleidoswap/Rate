import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { motion } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';
import { feedback } from '../utils/feedback';

const HOLD_MS = 1200;

interface Props {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function HoldToConfirm({ label, onConfirm, disabled = false, loading = false }: Props) {
  const t = useAppTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const pressing = useRef(false);
  const committed = useRef(false);
  const inactive = disabled || loading;

  useEffect(() => {
    if (inactive) {
      pressing.current = false;
      committed.current = false;
      progress.setValue(0);
    }
    return () => animation.current?.stop();
  }, [inactive, progress]);

  const animateProgress = (toValue: number, duration: number) => {
    animation.current?.stop();
    animation.current = Animated.timing(progress, { toValue, duration, easing: time => time, useNativeDriver: true });
    animation.current.start();
  };
  const pressIn = () => {
    if (inactive) return;
    pressing.current = true;
    committed.current = false;
    progress.setValue(0);
    animateProgress(1, HOLD_MS);
  };
  const pressOut = () => {
    pressing.current = false;
    animateProgress(0, motion.duration.fast);
  };
  const confirm = () => {
    if (inactive || committed.current) return;
    committed.current = true;
    feedback.tap();
    onConfirm();
  };
  const ink = inactive && !loading ? t.colors.text.tertiary : t.colors.primary[500];

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Hold to confirm"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'activate') confirm();
      }}
      disabled={inactive}
      delayLongPress={HOLD_MS}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onLongPress={() => { if (pressing.current) confirm(); }}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing[2],
        minHeight: 52, paddingHorizontal: t.spacing[3], paddingVertical: t.spacing[2],
        borderRadius: t.borderRadius.lg, borderWidth: 1, overflow: 'hidden',
        borderColor: inactive ? t.colors.border.light : t.colors.primary[500],
        backgroundColor: inactive ? t.colors.surface.secondary : t.colors.primary[50],
      }}
    >
      <Animated.View pointerEvents="none" style={[
        StyleSheet.absoluteFillObject,
        { backgroundColor: t.colors.primary[100], transformOrigin: 'left center', transform: [{ scaleX: progress }] },
      ]} />
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: ink + '1A' }}>
        {loading ? <ActivityIndicator size="small" color={ink} /> : <Ionicons name="finger-print" size={18} color={ink} />}
      </View>
      <Text style={{ flexShrink: 1, color: ink, fontSize: t.typography.fontSize.base, fontWeight: t.typography.fontWeight.semibold }}>
        {loading ? 'Sending…' : `Hold to ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
      </Text>
    </Pressable>
  );
}
