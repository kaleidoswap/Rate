import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { BrandMark } from './BrandMark';
import { BRAND_BG } from './BrandLoading';

export interface BrandIntroProps {
  /** Called once the outro fade completes. */
  onFinish?: () => void;
  /** Total time on screen before the fade-out begins (ms). Default 1300. */
  duration?: number;
  /** Size of the mark (px). Default 132. */
  markSize?: number;
}

const FADE_MS = 360;

/**
 * Full-screen branded launch animation: the kaleidoscope mark twists + blooms
 * into place over a pulsing glow, then the wordmark rises. After `duration` the
 * whole overlay fades out and calls `onFinish`. Pure Reanimated (UI thread).
 */
export const BrandIntro: React.FC<BrandIntroProps> = ({
  onFinish,
  duration = 1300,
  markSize = 132,
}) => {
  const markScale = useSharedValue(0.55);
  const markRotate = useSharedValue(-120);
  const markOpacity = useSharedValue(0);
  const glow = useSharedValue(0);
  const wordOpacity = useSharedValue(0);
  const wordShift = useSharedValue(16);
  const screen = useSharedValue(1);

  useEffect(() => {
    // Mark: kaleidoscope twist + bloom (snappier so the short intro feels crisp).
    markOpacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    markRotate.value = withSpring(0, { damping: 12, stiffness: 110, mass: 0.8 });
    markScale.value = withSequence(
      withSpring(1.05, { damping: 9, stiffness: 110, mass: 0.8 }),
      withSpring(1, { damping: 15, stiffness: 130 })
    );
    // Glow: gentle breathing pulse behind the mark.
    glow.value = withDelay(
      120,
      withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, true)
    );
    // Wordmark rises in shortly after the mark settles — finishes before fade.
    wordOpacity.value = withDelay(420, withTiming(1, { duration: 320 }));
    wordShift.value = withDelay(420, withSpring(0, { damping: 16, stiffness: 150 }));
    // Outro fade.
    screen.value = withDelay(
      Math.max(0, duration - FADE_MS),
      withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished && onFinish) runOnJS(onFinish)();
      })
    );
  }, []);

  const screenStyle = useAnimatedStyle(() => ({ opacity: screen.value }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }, { rotate: `${markRotate.value}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0.25, 0.55]),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.85, 1.18]) }],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateY: wordShift.value }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, screenStyle]} pointerEvents="none">
      <LinearGradient
        colors={BRAND_BG}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.center}>
        <View style={styles.markWrap}>
          <Animated.View style={[styles.glow, glowStyle]} />
          <Animated.View style={markStyle}>
            <BrandMark size={markSize} />
          </Animated.View>
        </View>
        <Animated.View style={[styles.words, wordStyle]}>
          <Text style={styles.wordmark}>
            Kaleido<Text style={styles.wordmarkAccent}>Swap</Text>
          </Text>
          <Text style={styles.tagline}>Bitcoin · Lightning · RGB</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { zIndex: 999, elevation: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  markWrap: { alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#15E99A',
  },
  words: { marginTop: 36, alignItems: 'center' },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.3,
    color: '#F4FFF9',
  },
  wordmarkAccent: { color: '#2BEE79' },
  tagline: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.4,
    color: 'rgba(190, 240, 215, 0.72)',
    textTransform: 'uppercase',
  },
});

export default BrandIntro;
