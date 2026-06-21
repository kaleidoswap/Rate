import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { BrandMark } from './BrandMark';

// Shared with BrandIntro so the intro's final frame and this steady-state
// loader are visually identical — the intro overlay fades out onto this with
// no jarring white flash.
// Navy (matches the app's dark background family #0A1326) rather than the old
// dark-forest green, so the loader reads as the same surface as the wallet.
export const BRAND_BG = ['#13213B', '#0A1326', '#06101F'] as [string, string, string];

interface BrandLoadingProps {
  /** Size of the kaleidoscope mark (px). */
  markSize?: number;
  /** Optional status line under the wordmark. */
  message?: string;
  /** Show the KaleidoSwap wordmark + tagline (default true). */
  showWordmark?: boolean;
}

const DOTS = [0, 1, 2];

/**
 * Steady-state branded loading screen: dark kaleidoscope background, the mark
 * over a breathing glow, and three softly pulsing dots. Designed to sit
 * directly behind <BrandIntro/> so the launch feels like one continuous moment.
 */
export const BrandLoading: React.FC<BrandLoadingProps> = ({
  markSize = 132,
  message,
  // Mark-only by default: there's no proper "KaleidoSwap" wordmark logo to set
  // under the mark, and the hand-typed name rendered incompletely — so skip the
  // letters and show just the (correct) kaleidoscope-K mark.
  showWordmark = false,
}) => {
  const glow = useSharedValue(0);
  const t = useSharedValue(0);

  useEffect(() => {
    glow.value = withRepeat(
      withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    t.value = withRepeat(withTiming(1, { duration: 1080, easing: Easing.linear }), -1, false);
  }, []);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0.22, 0.5]),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.9, 1.16]) }],
  }));

  // A small helper that returns the animated style for dot `i`, pulsing on a
  // staggered triangle wave so the three dots ripple left→right.
  const useDotStyle = (i: number) =>
    useAnimatedStyle(() => {
      'worklet';
      const phase = (t.value + i * 0.18) % 1;
      const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2; // 0→1→0
      return {
        opacity: 0.3 + tri * 0.7,
        transform: [{ scale: 0.85 + tri * 0.35 }],
      };
    });

  const dot0 = useDotStyle(0);
  const dot1 = useDotStyle(1);
  const dot2 = useDotStyle(2);
  const dotStyles = [dot0, dot1, dot2];

  return (
    <View style={styles.root}>
      <LinearGradient colors={BRAND_BG} start={{ x: 0.2, y: 0 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.center}>
        <View style={styles.markWrap}>
          <Animated.View style={[styles.glow, glowStyle]} />
          <BrandMark size={markSize} />
        </View>

        {showWordmark && (
          <View style={styles.words}>
            <Text style={styles.wordmark}>
              Kaleido<Text style={styles.wordmarkAccent}>Swap</Text>
            </Text>
            <Text style={styles.tagline}>Bitcoin · Lightning · RGB</Text>
          </View>
        )}

        <View style={styles.dots}>
          {DOTS.map((i) => (
            <Animated.View key={i} style={[styles.dot, dotStyles[i]]} />
          ))}
        </View>

        {!!message && <Text style={styles.message}>{message}</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#06101F' },
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
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: 0.3, color: '#F4FFF9' },
  wordmarkAccent: { color: '#2BEE79' },
  tagline: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.4,
    color: 'rgba(190, 240, 215, 0.72)',
    textTransform: 'uppercase',
  },
  dots: { flexDirection: 'row', gap: 9, marginTop: 40 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2BEE79' },
  message: {
    marginTop: 20,
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(190, 240, 215, 0.6)',
  },
});

export default BrandLoading;
