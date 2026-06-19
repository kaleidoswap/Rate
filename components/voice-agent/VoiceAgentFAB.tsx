import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { theme } from '../../theme';
import { feedback } from '../../utils/feedback';

interface VoiceAgentFABProps {
  /** Quick tap — open the assistant without auto-listening. */
  onPress: () => void;
  /** Press-and-hold completed — open the assistant and start listening immediately. */
  onHoldActivate?: () => void;
  /** Bottom offset so it floats above the tab bar. */
  bottom?: number;
  right?: number;
}

// How long the user must hold before listening kicks in. The charge ring fills
// over exactly this window so the visual and the gesture stay in lock-step.
const HOLD_MS = 450;
const SIZE = 60;
// Transparent breathing room around the orb. The idle halo (1.6×) and hold
// ripple (2.1×) scale well beyond SIZE; without this padding the round glow is
// clipped to the FAB's square box on Android (overflow:'visible' isn't reliably
// honored there for children drawn outside the parent bounds). The wrap is
// enlarged by GLOW_PAD on every side and its anchor is shifted by the same
// amount so the orb itself stays in exactly the same on-screen position.
const GLOW_PAD = 36;
const BOX = SIZE + GLOW_PAD * 2;

/**
 * Floating "Talk to KaleidoMind" button.
 *
 * - Idle: a gently breathing brand-green orb with a soft halo.
 * - Tap: opens the assistant.
 * - Press & hold: a charge ring sweeps to full while ripples pulse out and the
 *   orb swells; at completion it pops with success haptics and starts listening
 *   — a push-to-talk feel that makes the activation tangible.
 */
export const VoiceAgentFAB: React.FC<VoiceAgentFABProps> = ({ onPress, onHoldActivate, bottom = 96, right = 18 }) => {
  const breathe = useSharedValue(0);   // idle breathing loop
  const charge = useSharedValue(0);    // 0→1 while held
  const ripple = useSharedValue(0);    // repeating ripple while held
  const pop = useSharedValue(0);       // one-shot activation burst

  const startBreathing = () => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  };

  useEffect(() => {
    startBreathing();
    return () => {
      cancelAnimation(breathe);
      cancelAnimation(charge);
      cancelAnimation(ripple);
      cancelAnimation(pop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePressIn = () => {
    feedback.tap();
    cancelAnimation(breathe);
    breathe.value = withTiming(0, { duration: 150 });
    charge.value = withTiming(1, { duration: HOLD_MS, easing: Easing.out(Easing.quad) });
    ripple.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }), -1, false);
  };

  const handlePressOut = () => {
    cancelAnimation(ripple);
    ripple.value = withTiming(0, { duration: 150 });
    charge.value = withTiming(0, { duration: 180 });
    startBreathing();
  };

  const handleLongPress = () => {
    feedback.success();
    pop.value = withSequence(
      withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 260, easing: Easing.inOut(Easing.quad) }),
    );
    onHoldActivate?.();
  };

  // Idle halo (breathing) — fades out as soon as a hold begins.
  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breathe.value, [0, 1], [0.35, 0]),
    transform: [{ scale: interpolate(breathe.value, [0, 1], [0.9, 1.6]) }],
  }));

  // Expanding ripple ring while holding.
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ripple.value, [0, 1], [0.5, 0]) * charge.value,
    transform: [{ scale: interpolate(ripple.value, [0, 1], [1, 2.1]) }],
  }));

  // The charge ring: a bright border that grows and brightens as the hold fills.
  const chargeRingStyle = useAnimatedStyle(() => ({
    opacity: charge.value,
    transform: [{ scale: interpolate(charge.value, [0, 1], [1.0, 1.45]) }],
    borderWidth: interpolate(charge.value, [0, 1], [2, 4]),
  }));

  // Core orb: breathes when idle, swells while charging, pops on activation.
  const coreStyle = useAnimatedStyle(() => {
    const breatheScale = interpolate(breathe.value, [0, 1], [1, 1.06]);
    const chargeScale = interpolate(charge.value, [0, 1], [1, 1.16]);
    const popScale = interpolate(pop.value, [0, 1], [1, 0.86]); // squash on activation
    return { transform: [{ scale: breatheScale * chargeScale * popScale }] };
  });

  // Brightening inner glow as the charge completes.
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(charge.value, [0, 1], [0, 0.9]),
  }));

  return (
    <View style={[styles.wrap, { bottom: bottom - GLOW_PAD, right: right - GLOW_PAD }]} pointerEvents="box-none">
      <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none" />
      <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />
      <Animated.View style={[styles.chargeRing, chargeRingStyle]} pointerEvents="none" />
      <Animated.View style={coreStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onLongPress={handleLongPress}
          delayLongPress={HOLD_MS}
          accessibilityRole="button"
          accessibilityLabel="Talk to KaleidoMind"
          accessibilityHint="Tap to open, or press and hold to start talking"
          style={styles.fab}
        >
          <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none" />
          <Ionicons name="mic" size={26} color={theme.colors.text.inverse} />
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    width: BOX,
    height: BOX,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    zIndex: 50,
  },
  halo: {
    position: 'absolute',
    top: GLOW_PAD,
    left: GLOW_PAD,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: theme.colors.primary[500],
  },
  ripple: {
    position: 'absolute',
    top: GLOW_PAD,
    left: GLOW_PAD,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: theme.colors.primary[400] ?? theme.colors.primary[500],
  },
  chargeRing: {
    position: 'absolute',
    top: GLOW_PAD,
    left: GLOW_PAD,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderColor: theme.colors.primary[300] ?? theme.colors.primary[500],
  },
  fab: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.primary[300] ?? '#6EE7B7',
  },
});

export default VoiceAgentFAB;
