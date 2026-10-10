// Prismo — KaleidoMind's character: the illustrated crystal with the Bitcoin
// coin. Each state is a still of the approved artwork; the app adds breathing,
// blinking (the eyes are patched from the closed-eyes still) and a mouth that
// follows `level` while speaking. Loops stop under Reduce Motion, when `paused`,
// when the app is backgrounded and on unmount.
import React, { useEffect, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
import Svg, { Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { motion, theme } from '../../theme';
import { FACE, FACE_PATHS, PRISMO_BODY_PATH } from './prismoGeometry';
import type { MindMood } from './mindMood';

export type { MindMood } from './mindMood';

type Pose = 'idle' | 'listening' | 'thinking' | 'speaking' | 'success' | 'asleep';

const ART: Record<Pose, number> = {
  idle: require('../../assets/prismo/idle.png'),
  listening: require('../../assets/prismo/listening.png'),
  thinking: require('../../assets/prismo/thinking.png'),
  speaking: require('../../assets/prismo/speaking.png'),
  success: require('../../assets/prismo/success.png'),
  asleep: require('../../assets/prismo/idle-blink.png'),
};
/** The same poses with eyes (and for speaking, mouth) closed, patched over the still. */
const CLOSED: Partial<Record<Pose, number>> = {
  idle: require('../../assets/prismo/idle-blink.png'),
  listening: require('../../assets/prismo/listening-blink.png'),
  thinking: require('../../assets/prismo/thinking-blink.png'),
  speaking: require('../../assets/prismo/speaking-blink.png'),
};
const POSES = Object.keys(ART) as Pose[];

const POSE_OF: Record<MindMood, Pose> = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  happy: 'success',
  concerned: 'thinking',
  sleeping: 'asleep',
};

const TILT: Record<MindMood, number> = {
  idle: 0, listening: 1.4, thinking: -2, speaking: 0, happy: 0, concerned: 3, sleeping: 0,
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

// Face regions of the aligned artwork, as shares of the image (x, y, w, h).
const EYES = [
  [0.348, 0.388, 0.143, 0.145],
  [0.584, 0.326, 0.124, 0.151],
] as const;
const MOUTH = [0.49, 0.448, 0.115, 0.104] as const;

const D = motion.brandDuration;
const EASE = Easing.bezier(...motion.brandEase.standard);

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

function FacePatch({ source, rect, size, opacity }: {
  source: number;
  rect: readonly number[];
  size: number;
  /** Read on the UI thread each frame. */
  opacity: () => number;
}) {
  const [x, y, w, h] = rect;
  const style = useAnimatedStyle(() => ({ opacity: opacity() }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: x * size, top: y * size, width: w * size, height: h * size, borderRadius: size * 0.04, overflow: 'hidden' }, style]}
    >
      <Image
        source={source}
        fadeDuration={0}
        resizeMode="contain"
        style={{ position: 'absolute', left: -x * size, top: -y * size, width: size, height: size }}
      />
    </Animated.View>
  );
}

function PoseLayer({ pose, size, active, blink, mouthClosed }: {
  pose: Pose;
  size: number;
  active: SharedValue<number>;
  blink: SharedValue<number>;
  mouthClosed: () => number;
}) {
  const style = useAnimatedStyle(() => ({ opacity: active.value }));
  const closed = CLOSED[pose];
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Image source={ART[pose]} fadeDuration={0} resizeMode="contain" style={{ width: size, height: size }} />
      {closed && pose !== 'asleep' ? EYES.map((r, i) => <FacePatch key={i} source={closed} rect={r} size={size} opacity={() => { 'worklet'; return blink.value; }} />) : null}
      {pose === 'speaking' && closed ? <FacePatch source={closed} rect={MOUTH} size={size} opacity={mouthClosed} /> : null}
    </Animated.View>
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
  const pose = POSE_OF[mood];
  const hasLevel = level !== undefined;

  const active = {
    idle: useSharedValue(pose === 'idle' ? 1 : 0),
    listening: useSharedValue(pose === 'listening' ? 1 : 0),
    thinking: useSharedValue(pose === 'thinking' ? 1 : 0),
    speaking: useSharedValue(pose === 'speaking' ? 1 : 0),
    success: useSharedValue(pose === 'success' ? 1 : 0),
    asleep: useSharedValue(pose === 'asleep' ? 1 : 0),
  } as Record<Pose, SharedValue<number>>;
  const breathe = useSharedValue(0);
  const tilt = useSharedValue(TILT[mood]);
  const blink = useSharedValue(0);
  const syllable = useSharedValue(0);
  const internalLevel = useSharedValue(typeof level === 'number' ? clamp01(level) : 0);
  const lvl = typeof level === 'object' && level !== null ? level : internalLevel;

  useEffect(() => {
    if (typeof level === 'number') internalLevel.value = withTiming(clamp01(level), { duration: D.fast });
  }, [level, internalLevel]);

  useEffect(() => {
    POSES.forEach((p) => {
      const to = p === pose ? 1 : 0;
      active[p].value = live ? withTiming(to, { duration: 300, easing: EASE }) : to;
    });
    tilt.value = live ? withTiming(TILT[mood], { duration: 460, easing: EASE }) : TILT[mood];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, mood, live]);

  useEffect(() => {
    cancelAnimation(breathe);
    if (!live) {
      breathe.value = 0;
      return;
    }
    breathe.value = withRepeat(withTiming(1, { duration: mood === 'sleeping' ? 4800 : 2800, easing: EASE }), -1, true);
    return () => cancelAnimation(breathe);
  }, [live, mood, breathe]);

  // A blink every few seconds, now and then a quick double.
  useEffect(() => {
    blink.value = 0;
    if (!live || mood === 'happy' || mood === 'sleeping' || mood === 'thinking') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        if (stopped) return;
        blink.value = withSequence(withTiming(1, { duration: 65 }), withDelay(45, withTiming(0, { duration: 115 })));
        schedule(Math.random() < 0.12 ? 220 : 2800 + Math.random() * 3200);
      }, delay);
    };
    schedule(1600 + Math.random() * 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimation(blink);
    };
  }, [live, mood, blink]);

  // Without a voice level, a varied syllable rhythm so the mouth never looks mechanical.
  useEffect(() => {
    cancelAnimation(syllable);
    syllable.value = 0;
    if (!live || mood !== 'speaking' || hasLevel) return;
    syllable.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 110 }),
        withTiming(0.15, { duration: 150 }),
        withTiming(0.8, { duration: 95 }),
        withTiming(0, { duration: 180 }),
        withTiming(1, { duration: 120 }),
        withDelay(140, withTiming(0.2, { duration: 160 })),
        withTiming(0.9, { duration: 100 }),
        withTiming(0, { duration: 200 }),
        withTiming(1, { duration: 140 }),
        withDelay(360, withTiming(0, { duration: 1 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(syllable);
  }, [live, mood, hasLevel, syllable]);

  // Opacity of the closed-mouth patch: 1 closed, 0 open.
  const speakingLive = mood === 'speaking' && live;
  const mouthClosed = () => {
    'worklet';
    const open = speakingLive ? (hasLevel ? lvl.value : syllable.value) : 0;
    return 1 - (open < 0 ? 0 : open > 1 ? 1 : open);
  };

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(breathe.value, [0, 1], [0, -size * 0.018]) },
      { rotate: `${tilt.value}deg` },
    ],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(breathe.value, [0, 1], [1, 0.92]) }],
  }));

  const content = (
    <View style={[{ width: size, height: size }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: size * 0.28,
            bottom: size * 0.025,
            width: size * 0.44,
            height: size * 0.035,
            borderRadius: size,
            backgroundColor: theme.colors.primary[500],
            opacity: mood === 'sleeping' ? 0.05 : 0.1,
          },
          shadowStyle,
        ]}
      />
      <Animated.View style={[{ width: size, height: size }, bodyStyle]}>
        {POSES.map((p) => (
          <PoseLayer key={p} pose={p} size={size} active={active[p]} blink={blink} mouthClosed={mouthClosed} />
        ))}
      </Animated.View>
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

export default MindCharacter;
