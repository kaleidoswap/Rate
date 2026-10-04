// components/SlideToConfirm.tsx
//
// Drag the knob to the end to confirm: hard to trigger by accident, which is
// what a payment needs. Releasing early springs it back. Screen readers get a
// plain "activate" action with the same label. Fires once per completed slide.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { theme, motion } from '../theme';
import { feedback } from '../utils/feedback';

interface SlideToConfirmProps {
  /** What sliding does, e.g. "Pay 21,021 sats". Shown as "Slide to pay …" and read by screen readers. */
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

const KNOB = 44;
const PAD = 4;

export function SlideToConfirm({ label, onConfirm, disabled, loading, testID }: SlideToConfirmProps) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const max = Math.max(0, width - KNOB - PAD * 2);
  const inactive = disabled || loading;

  // Back to the start whenever it can't be used (e.g. after paying, or a quote refresh).
  useEffect(() => { if (inactive) x.value = withTiming(0, { duration: motion.duration.base }); }, [inactive, x]);

  const confirm = () => { feedback.tap(); onConfirm(); };

  const drag = Gesture.Pan()
    .enabled(!inactive && max > 0)
    .onUpdate(e => { x.value = Math.min(max, Math.max(0, e.translationX)); })
    .onEnd(() => {
      if (x.value >= max * 0.9) {
        x.value = withSpring(max, motion.spring);
        runOnJS(confirm)();
      } else {
        x.value = withSpring(0, motion.spring);
      }
    });

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + KNOB + PAD }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: max > 0 ? interpolate(x.value, [0, max * 0.6], [1, 0]) : 1 }));

  return (
    <View
      testID={testID}
      style={[styles.track, inactive && styles.trackOff]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Slide to the end, or activate, to confirm"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'activate' && !inactive) confirm(); }}
    >
      <Animated.View pointerEvents="none" style={[styles.fill, fillStyle]} />
      <Animated.View pointerEvents="none" style={labelStyle}>
        <Text style={[styles.label, inactive && styles.labelOff]} numberOfLines={1}>
          {loading ? 'Sending…' : `Slide to ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        </Text>
      </Animated.View>
      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.knob, inactive && styles.knobOff, knobStyle]}>
          {loading
            ? <ActivityIndicator size="small" color={theme.colors.text.inverse} />
            : <Ionicons name="arrow-forward" size={20} color={inactive ? theme.colors.text.tertiary : theme.colors.text.inverse} />}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: KNOB + PAD * 2,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[50],
    borderWidth: 1,
    borderColor: theme.colors.primary[500],
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackOff: { backgroundColor: theme.colors.surface.secondary, borderColor: theme.colors.border.light },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.primary[100],
  },
  label: {
    textAlign: 'center',
    paddingLeft: KNOB,
    paddingRight: theme.spacing[3],
    color: theme.colors.primary[500],
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  labelOff: { color: theme.colors.text.tertiary },
  knob: {
    position: 'absolute',
    left: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobOff: { backgroundColor: theme.colors.border.light },
});

export default SlideToConfirm;
