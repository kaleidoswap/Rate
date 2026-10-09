// Prismo — KaleidoMind's character: a small faceted prism with dot eyes.
// All motion runs on the UI thread (transforms/opacity on Animated.Views over
// static SVG layers); loops stop under Reduce Motion, when `paused`, when the
// app is backgrounded and on unmount.
import React, { useEffect, useId, useState } from 'react';
import { AppState, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { motion, theme } from '../../theme';
import {
  FACE,
  FACE_PATHS,
  FACET_LIGHT_A,
  FACET_LIGHT_B,
  PRISMO_BODY_PATH,
  PRISMO_FACET_PATHS,
} from './prismoGeometry';
import type { MindMood } from './mindMood';

export type { MindMood } from './mindMood';

const C = theme.colors.mind;
const D = motion.brandDuration;
const EASE_SPRING = Easing.bezier(...motion.brandEase.spring);
const EASE_STD = Easing.bezier(...motion.brandEase.standard);
const STATIC_SPARKLE = 0.6;

interface Pose {
  lookX: number;
  lookY: number;
  eyeScale: number;
  tilt: number;
  dim: number;
  amber: number;
}

const POSES: Record<MindMood, Pose> = {
  idle: { lookX: 0, lookY: 0, eyeScale: 1, tilt: 0, dim: 1, amber: 0 },
  listening: { lookX: 0, lookY: 0, eyeScale: 1.22, tilt: 0, dim: 1, amber: 0 },
  thinking: { lookX: 0.45, lookY: -0.55, eyeScale: 0.92, tilt: 0, dim: 1, amber: 0 },
  speaking: { lookX: 0, lookY: 0.05, eyeScale: 1, tilt: 0, dim: 1, amber: 0 },
  happy: { lookX: 0, lookY: 0, eyeScale: 1, tilt: 0, dim: 1, amber: 0 },
  concerned: { lookX: 0, lookY: 0.25, eyeScale: 0.95, tilt: 14, dim: 1, amber: 1 },
  sleeping: { lookX: 0, lookY: 0, eyeScale: 1, tilt: 0, dim: 0.5, amber: 0 },
};

/** Loop periods in ms; 0 turns that loop off for the mood. */
const LOOPS: Record<MindMood, { breathe: number; blink: number; shimmer: number }> = {
  idle: { breathe: 3200, blink: 3800, shimmer: 3600 },
  listening: { breathe: 1400, blink: 5200, shimmer: 1400 },
  thinking: { breathe: 3200, blink: 0, shimmer: 1800 },
  speaking: { breathe: 2000, blink: 4200, shimmer: 2400 },
  happy: { breathe: 2400, blink: 0, shimmer: 900 },
  concerned: { breathe: 2800, blink: 3000, shimmer: 4800 },
  sleeping: { breathe: 4800, blink: 0, shimmer: 0 },
};

const MOOD_LABEL: Record<MindMood, string> = {
  idle: 'ready',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  happy: 'happy',
  concerned: 'concerned',
  sleeping: 'asleep',
};

const SPARKLE_ANGLES = [-75, -15, 45, 105, 165, 225].map((a) => (a * Math.PI) / 180);
const ORBIT_ANGLES = [0, 120, 240].map((a) => (a * Math.PI) / 180);

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function useAppActive(): boolean {
  const [active, setActive] = useState(() => {
    const s = AppState?.currentState;
    return s == null || s === 'active';
  });
  useEffect(() => {
    const sub = AppState?.addEventListener?.('change', (s) => setActive(s === 'active'));
    return () => sub?.remove?.();
  }, []);
  return active;
}

export interface MindCharacterProps {
  mood: MindMood;
  size?: number;
  /** 0..1 loudness (mic level while listening, voice level while speaking). */
  level?: SharedValue<number> | number;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** false renders a static pose (lists, badges). */
  animated?: boolean;
  /** Stop loops while the host is off-screen. */
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
}

function BodyLayer({ size, gradient, facets, id }: { size: number; gradient: [string, string]; facets?: number[]; id: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradient[0]} />
          <Stop offset="1" stopColor={gradient[1]} />
        </LinearGradient>
        {facets ? (
          <ClipPath id={`c${id}`}>
            <Path d={PRISMO_BODY_PATH} />
          </ClipPath>
        ) : null}
      </Defs>
      <Path d={PRISMO_BODY_PATH} fill={`url(#g${id})`} />
      {facets ? (
        <G clipPath={`url(#c${id})`}>
          {PRISMO_FACET_PATHS.map((d, i) => (
            <Path key={i} d={d} fill={C.highlight} fillOpacity={facets[i]} />
          ))}
        </G>
      ) : null}
    </Svg>
  );
}

function FacetLayer({ size, light, id }: { size: number; light: number[]; id: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs>
        <ClipPath id={`f${id}`}>
          <Path d={PRISMO_BODY_PATH} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#f${id})`}>
        {PRISMO_FACET_PATHS.map((d, i) => (
          <Path key={i} d={d} fill={C.highlight} fillOpacity={light[i]} />
        ))}
      </G>
    </Svg>
  );
}

function Sparkle({ progress, angle, radius, dot, color }: { progress: SharedValue<number>; angle: number; radius: number; dot: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const r = radius * (0.55 + 0.45 * p);
    return {
      opacity: interpolate(p, [0, 0.15, 0.6, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: Math.cos(angle) * r },
        { translateY: Math.sin(angle) * r },
        { rotate: '45deg' },
        { scale: interpolate(p, [0, 0.3, 1], [0.4, 1, 0.6]) },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.centered,
        { width: dot, height: dot, marginLeft: -dot / 2, marginTop: -dot / 2, borderRadius: dot * 0.2, backgroundColor: color },
        style,
      ]}
    />
  );
}

export function MindCharacter({
  mood,
  size = 96,
  level,
  onPress,
  accessibilityLabel,
  animated = true,
  paused = false,
  style,
}: MindCharacterProps) {
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const live = animated && !paused && !reduceMotion && appActive;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const body = size >= 40 ? size * 0.82 : size * 0.92;
  const showMouth = size >= 32;
  const eyeW = Math.max(2, body * 0.1);
  const eyeH = Math.max(2.4, body * 0.13);
  const faceStroke = size < 40 ? 7 : 4.5;

  const internalLevel = useSharedValue(typeof level === 'number' ? clamp01(level) : 0);
  const lvl = typeof level === 'object' && level !== null ? level : internalLevel;
  const hasLevel = level !== undefined;
  useEffect(() => {
    if (typeof level === 'number') internalLevel.value = withTiming(clamp01(level), { duration: D.fast });
  }, [level, internalLevel]);

  const breathe = useSharedValue(0);
  const blink = useSharedValue(1);
  const shimmer = useSharedValue(0);
  const hue = useSharedValue(mood === 'thinking' ? 0.5 : 0);
  const orbit = useSharedValue(0);
  const speak = useSharedValue(mood === 'speaking' ? 0.5 : 0);
  const sparkle = useSharedValue(mood === 'happy' ? STATIC_SPARKLE : 0);
  const hop = useSharedValue(0);

  const initial = POSES[mood];
  const lookX = useSharedValue(initial.lookX);
  const lookY = useSharedValue(initial.lookY);
  const eyeScale = useSharedValue(initial.eyeScale);
  const tilt = useSharedValue(initial.tilt);
  const dim = useSharedValue(initial.dim);
  const amber = useSharedValue(initial.amber);

  useEffect(() => {
    const pose = POSES[mood];
    const to = (v: number) => (live ? withTiming(v, { duration: D.base, easing: EASE_STD }) : v);
    lookX.value = to(pose.lookX);
    lookY.value = to(pose.lookY);
    eyeScale.value = to(pose.eyeScale);
    tilt.value = to(pose.tilt);
    dim.value = to(pose.dim);
    amber.value = to(pose.amber);
  }, [mood, live, lookX, lookY, eyeScale, tilt, dim, amber]);

  useEffect(() => {
    const loops = [breathe, blink, shimmer, hue, orbit, speak, sparkle, hop];
    loops.forEach((v) => cancelAnimation(v));
    if (!live) {
      breathe.value = 0;
      blink.value = 1;
      shimmer.value = 0;
      hue.value = mood === 'thinking' ? 0.5 : 0;
      orbit.value = 0;
      speak.value = mood === 'speaking' ? 0.5 : 0;
      sparkle.value = mood === 'happy' ? STATIC_SPARKLE : 0;
      hop.value = 0;
      return;
    }
    const l = LOOPS[mood];
    breathe.value = withRepeat(withTiming(1, { duration: l.breathe, easing: EASE_STD }), -1, true);
    blink.value = l.blink
      ? withRepeat(
          withSequence(
            withDelay(l.blink, withTiming(0.1, { duration: D.fast, easing: EASE_STD })),
            withTiming(1, { duration: D.fast, easing: EASE_STD }),
          ),
          -1,
          false,
        )
      : 1;
    shimmer.value = l.shimmer ? withRepeat(withTiming(1, { duration: l.shimmer, easing: EASE_STD }), -1, true) : 0;
    if (mood === 'thinking') {
      hue.value = withRepeat(withTiming(1, { duration: 2400, easing: EASE_STD }), -1, true);
      orbit.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear }), -1, false);
    } else {
      hue.value = withTiming(0, { duration: D.base, easing: EASE_STD });
      orbit.value = 0;
    }
    speak.value =
      mood === 'speaking' && !hasLevel
        ? withRepeat(
            withSequence(
              withTiming(1, { duration: D.fast, easing: EASE_STD }),
              withTiming(0.3, { duration: D.fast, easing: EASE_STD }),
              withTiming(0.8, { duration: D.fast, easing: EASE_STD }),
              withTiming(0.1, { duration: D.base, easing: EASE_STD }),
            ),
            -1,
            false,
          )
        : 0;
    if (mood === 'happy') {
      sparkle.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: D.slow, easing: EASE_SPRING }));
      hop.value = withSequence(
        withTiming(1, { duration: D.fast, easing: EASE_SPRING }),
        withTiming(0, { duration: D.base, easing: EASE_STD }),
      );
    } else {
      sparkle.value = 0;
      hop.value = 0;
    }
    return () => loops.forEach((v) => cancelAnimation(v));
  }, [mood, live, hasLevel, breathe, blink, shimmer, hue, orbit, speak, sparkle, hop]);

  const levelDriven = mood === 'listening' || mood === 'speaking';

  const bodyStyle = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [
      { translateY: -hop.value * body * 0.07 - breathe.value * body * 0.015 },
      { scale: 1 + breathe.value * 0.025 + (levelDriven ? lvl.value * 0.07 : 0) },
    ],
  }));
  const hueStyle = useAnimatedStyle(() => ({
    opacity: mood === 'listening' ? lvl.value * 0.85 : hue.value * 0.9,
  }));
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));
  const amberStyle = useAnimatedStyle(() => ({ opacity: amber.value * 0.55 }));
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lookX.value * eyeW }, { translateY: lookY.value * eyeH }],
  }));
  const leftEyeStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${tilt.value}deg` },
      { scaleY: blink.value },
      { scale: eyeScale.value + (mood === 'listening' ? lvl.value * 0.15 : 0) },
    ],
  }));
  const rightEyeStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${-tilt.value}deg` },
      { scaleY: blink.value },
      { scale: eyeScale.value + (mood === 'listening' ? lvl.value * 0.15 : 0) },
    ],
  }));
  const mouthStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.35 + (hasLevel ? lvl.value : speak.value) * 1.4 }],
  }));
  const orbitStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${orbit.value * 360}deg` }] }));

  const dotEyes = mood !== 'happy' && mood !== 'sleeping';
  const facePath =
    mood === 'happy'
      ? [FACE_PATHS.happyLeft, FACE_PATHS.happyRight, ...(showMouth ? [FACE_PATHS.grin] : [])]
      : mood === 'sleeping'
        ? [FACE_PATHS.closedLeft, FACE_PATHS.closedRight]
        : !showMouth || mood === 'speaking'
          ? []
          : [mood === 'concerned' ? FACE_PATHS.frown : mood === 'thinking' ? FACE_PATHS.flat : FACE_PATHS.smile];
  const eyeLeft = (FACE.eyeLeftX / 100) * body - eyeW / 2;
  const eyeRight = (FACE.eyeRightX / 100) * body - eyeW / 2;
  const eyeTop = (FACE.eyeY / 100) * body - eyeH / 2;
  const mouthW = body * 0.13;
  const mouthH = body * 0.075;
  const orbitDot = Math.max(3, size * 0.05);
  const sparkleDot = Math.max(3, size * 0.07);

  const content = (
    <View style={[{ width: size, height: size }, styles.root, style]} pointerEvents={onPress ? undefined : 'none'}>
      {mood === 'thinking' ? (
        <Animated.View style={[StyleSheet.absoluteFill, orbitStyle]} pointerEvents="none">
          {ORBIT_ANGLES.map((a, i) => (
            <View
              key={i}
              style={[
                styles.centered,
                {
                  width: orbitDot,
                  height: orbitDot,
                  borderRadius: orbitDot / 2,
                  marginLeft: -orbitDot / 2 + Math.cos(a) * size * 0.46,
                  marginTop: -orbitDot / 2 + Math.sin(a) * size * 0.46,
                  backgroundColor: i === 0 ? C.green : i === 1 ? C.violet : C.highlight,
                  opacity: i === 2 ? 0.7 : 1,
                },
              ]}
            />
          ))}
        </Animated.View>
      ) : null}

      <Animated.View style={[{ width: body, height: body }, bodyStyle]}>
        <BodyLayer size={body} gradient={[C.green, C.violet]} facets={FACET_LIGHT_A} id={`a${uid}`} />
        {mood === 'thinking' || mood === 'listening' ? (
          <Animated.View style={[StyleSheet.absoluteFill, hueStyle]}>
            <BodyLayer size={body} gradient={[C.violetDeep, C.green]} facets={FACET_LIGHT_B} id={`h${uid}`} />
          </Animated.View>
        ) : null}
        {mood === 'concerned' ? (
          <Animated.View style={[StyleSheet.absoluteFill, amberStyle]}>
            <BodyLayer size={body} gradient={[C.amber, C.violetDeep]} id={`m${uid}`} />
          </Animated.View>
        ) : null}
        {live && LOOPS[mood].shimmer ? (
          <Animated.View style={[StyleSheet.absoluteFill, shimmerStyle]}>
            <FacetLayer size={body} light={FACET_LIGHT_B} id={`s${uid}`} />
          </Animated.View>
        ) : null}
        <Svg width={body} height={body} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
          <Path d={PRISMO_BODY_PATH} fill="none" stroke={C.highlight} strokeOpacity={0.28} strokeWidth={1.5} />
          {facePath.map((d) => (
            <Path key={d} d={d} fill="none" stroke={C.ink} strokeWidth={faceStroke} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>

        {dotEyes ? (
          <Animated.View style={[StyleSheet.absoluteFill, eyesStyle]}>
            <Animated.View
              style={[styles.eye, { left: eyeLeft, top: eyeTop, width: eyeW, height: eyeH, borderRadius: eyeW / 2 }, leftEyeStyle]}
            />
            <Animated.View
              style={[styles.eye, { left: eyeRight, top: eyeTop, width: eyeW, height: eyeH, borderRadius: eyeW / 2 }, rightEyeStyle]}
            />
          </Animated.View>
        ) : null}

        {mood === 'speaking' && showMouth ? (
          <Animated.View
            style={[
              styles.eye,
              {
                left: body / 2 - mouthW / 2,
                top: (FACE.mouthY / 100) * body - mouthH / 2,
                width: mouthW,
                height: mouthH,
                borderRadius: mouthH / 2,
              },
              mouthStyle,
            ]}
          />
        ) : null}
      </Animated.View>

      {mood === 'happy'
        ? SPARKLE_ANGLES.map((a, i) => (
            <Sparkle
              key={i}
              progress={sparkle}
              angle={a}
              radius={size * 0.5}
              dot={sparkleDot}
              color={i % 2 ? C.violet : C.green}
            />
          ))
        : null}
    </View>
  );

  const label = accessibilityLabel ?? `Prismo, ${MOOD_LABEL[mood]}`;
  if (!onPress) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      {content}
    </Pressable>
  );
}

export interface MindCharacterBadgeProps {
  size?: number;
  mood?: MindMood;
  /** Monochrome tint (e.g. a tab bar's active/inactive color). Omit for full color. */
  color?: string;
  /** With `color`: filled when focused, outlined otherwise. */
  focused?: boolean;
  /** Fill behind the cut-out eyes when focused (the surface the badge sits on). */
  cutoutColor?: string;
  accessibilityLabel?: string;
}

/** A static Prismo for inline and tab-bar use (≤ 28px, never loops). */
export function MindCharacterBadge({
  size = 24,
  mood = 'idle',
  color,
  focused = false,
  cutoutColor = theme.colors.surface.primary,
  accessibilityLabel,
}: MindCharacterBadgeProps) {
  const s = Math.min(size, 28);
  if (!color) {
    return <MindCharacter mood={mood} size={s} animated={false} accessibilityLabel={accessibilityLabel} />;
  }
  const eyeFill = focused ? cutoutColor : color;
  const closed = mood === 'sleeping';
  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      style={{ width: s, height: s }}
    >
      <Svg width={s} height={s} viewBox="0 0 100 100">
        <Path
          d={PRISMO_BODY_PATH}
          fill={focused ? color : 'none'}
          stroke={color}
          strokeWidth={8}
          strokeLinejoin="round"
        />
        {closed ? (
          <>
            <Path d={FACE_PATHS.closedLeft} fill="none" stroke={eyeFill} strokeWidth={8} strokeLinecap="round" />
            <Path d={FACE_PATHS.closedRight} fill="none" stroke={eyeFill} strokeWidth={8} strokeLinecap="round" />
          </>
        ) : (
          <>
            <Rect x={FACE.eyeLeftX - 6} y={FACE.eyeY - 8} width={12} height={16} rx={6} fill={eyeFill} />
            <Rect x={FACE.eyeRightX - 6} y={FACE.eyeY - 8} width={12} height={16} rx={6} fill={eyeFill} />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  centered: { position: 'absolute', left: '50%', top: '50%' },
  eye: { position: 'absolute', backgroundColor: C.ink },
});

export default MindCharacter;
