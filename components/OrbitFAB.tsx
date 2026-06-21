import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';

/** A single selectable action on the orbit. */
export interface OrbitAction {
  key: string;
  /** Short name shown in the hover tooltip while dragging. */
  label: string;
  /** Accent color — used for the petal fill (when selected), border and glow. */
  color: string;
  /** Icon node, rendered white on the petal. */
  renderIcon: () => React.ReactNode;
  /** Fired when the finger is released over this petal. */
  onSelect: () => void;
}

interface OrbitFABProps {
  /** Quick tap (no hold/drag) — the FAB's default action. */
  onDefaultPress: () => void;
  /** Icon for the resting center button. */
  renderCenterIcon: () => React.ReactNode;
  /** Petals, laid out left→right across an upward fan. Keep to ~3–5. */
  actions: OrbitAction[];
}

const FAB = 60;
const PETAL = 52;
const RADIUS = 96;            // center-to-petal distance
const OPEN_DELAY = 160;       // hold this long → orbit opens (shorter = a tap → default)
const OPEN_MOVE = 8;          // …or move this far first → open immediately
const DEAD_ZONE = 36;         // finger this close to center → no selection (cancel region)
const SELECT_SLOP = 46;       // max angular distance (deg) from a petal to capture it
const SPRING = { damping: 14, stiffness: 180, mass: 0.6 } as const;

/**
 * Expandable radial "orbit" FAB.
 *
 * - Quick tap → `onDefaultPress` (the QR scanner).
 * - Press & hold (or press + drag) → an arc of action petals fans out above the
 *   button with a spring. Slide the finger toward a petal to highlight it and
 *   release to fire it — all in one continuous gesture, no lift required.
 *
 * The whole interaction lives inside one Pan gesture, so once the touch begins,
 * gesture-handler tracks the finger across the entire screen even though the
 * petals render outside the tab-bar bounds.
 */
export const OrbitFAB: React.FC<OrbitFABProps> = ({ onDefaultPress, renderCenterIcon, actions }) => {
  const progress = useSharedValue(0); // 0 = closed, 1 = fully fanned out
  const sel = useSharedValue(-1);     // currently highlighted petal index
  const [mounted, setMounted] = useState(false); // overlay mounted only while active
  const [hovered, setHovered] = useState(-1);     // mirror of sel for the tooltip

  // Even fan from 150° (left) to 30° (right); single action sits straight up.
  const positions = useMemo(() => {
    const n = actions.length;
    return actions.map((_, i) => {
      const angle = n <= 1 ? 90 : 150 - i * (120 / (n - 1));
      const rad = (angle * Math.PI) / 180;
      return { angle, x: RADIUS * Math.cos(rad), y: -RADIUS * Math.sin(rad) };
    });
  }, [actions.length]);
  const angles = useMemo(() => positions.map((p) => p.angle), [positions]);

  // Which petal does the finger point at? Direction-based (distance along the ray
  // doesn't matter), with a dead zone near the center that selects nothing.
  const pickIndex = (dx: number, dy: number) => {
    'worklet';
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < DEAD_ZONE) return -1;
    const ang = (Math.atan2(-dy, dx) * 180) / Math.PI; // up = +90
    let best = -1;
    let bestDiff = 999;
    for (let i = 0; i < angles.length; i += 1) {
      let d = Math.abs(ang - angles[i]);
      if (d > 180) d = 360 - d;
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return bestDiff <= SELECT_SLOP ? best : -1;
  };

  const onHover = (idx: number) => {
    setHovered(idx);
    if (idx >= 0) feedback.select();
  };

  const fire = (idx: number) => {
    if (idx >= 0 && idx < actions.length) {
      feedback.success();
      actions[idx].onSelect();
    }
  };

  const close = () => {
    'worklet';
    cancelAnimation(progress);
    progress.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }, () => {
      runOnJS(setMounted)(false);
    });
    sel.value = -1;
    runOnJS(setHovered)(-1);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      sel.value = -1;
      runOnJS(setMounted)(true);
      runOnJS(feedback.tap)();
      // Delay the open so a quick tap stays a tap; a sustained press fans out.
      progress.value = withDelay(OPEN_DELAY, withSpring(1, SPRING));
    })
    .onUpdate((e) => {
      const dist = Math.sqrt(e.translationX * e.translationX + e.translationY * e.translationY);
      // Moving before the delay elapses opens the orbit right away.
      if (progress.value === 0 && dist > OPEN_MOVE) {
        cancelAnimation(progress);
        progress.value = withSpring(1, SPRING);
      }
      if (progress.value > 0.15) {
        const idx = pickIndex(e.translationX, e.translationY);
        if (idx !== sel.value) {
          sel.value = idx;
          runOnJS(onHover)(idx);
        }
      }
    })
    .onEnd((e) => {
      const dist = Math.sqrt(e.translationX * e.translationX + e.translationY * e.translationY);
      const opened = progress.value > 0;
      const chosen = sel.value;
      // Tap (released during the open delay) or a barely-there press with nothing
      // highlighted → run the default action.
      if (!opened || (progress.value < 0.25 && dist <= OPEN_MOVE && chosen < 0)) {
        runOnJS(onDefaultPress)();
      } else if (chosen >= 0) {
        runOnJS(fire)(chosen);
      }
    })
    .onFinalize(() => {
      close();
    });

  const fabStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - 0.06 * progress.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.45,
  }));

  const tooltipStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  return (
    <View style={styles.root} pointerEvents="box-none">
      {mounted && (
        <>
          <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents="none" />
          {actions.map((a, i) => (
            <Petal
              key={a.key}
              index={i}
              pos={positions[i]}
              color={a.color}
              progress={progress}
              sel={sel}
            >
              {a.renderIcon()}
            </Petal>
          ))}
          <Animated.View style={[styles.tooltipWrap, tooltipStyle]} pointerEvents="none">
            {hovered >= 0 && (
              <View style={styles.tooltip}>
                <Text style={styles.tooltipText}>{actions[hovered].label}</Text>
              </View>
            )}
          </Animated.View>
        </>
      )}

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fab, fabStyle]} accessibilityRole="button" accessibilityLabel="Quick actions">
          {renderCenterIcon()}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

interface PetalProps {
  index: number;
  pos: { x: number; y: number };
  color: string;
  progress: SharedValue<number>;
  sel: SharedValue<number>;
  children: React.ReactNode;
}

const Petal: React.FC<PetalProps> = ({ index, pos, color, progress, sel, children }) => {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const isSel = sel.value === index;
    const scale = (0.5 + 0.5 * p) * (isSel ? 1.2 : 1);
    return {
      opacity: Math.min(1, p * 1.5),
      // Highlighted petal gets a bright white ring + extra lift; the accent fill
      // and colored glow carry each petal's identity.
      borderColor: isSel ? '#FFFFFF' : 'rgba(255,255,255,0.16)',
      borderWidth: isSel ? 2.5 : 1.5,
      shadowOpacity: isSel ? 0.85 : 0.5,
      shadowRadius: isSel ? 14 : 10,
      transform: [{ translateX: pos.x * p }, { translateY: pos.y * p }, { scale }],
    };
  });

  return (
    <Animated.View
      style={[styles.petal, { backgroundColor: color, shadowColor: color }, style]}
      pointerEvents="none"
    >
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    width: FAB,
    height: FAB,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  // Big, centered dim layer that fades in behind the petals. pointerEvents none —
  // the active Pan gesture owns the touch stream, so the scrim never intercepts.
  scrim: {
    position: 'absolute',
    width: 1600,
    height: 1600,
    left: FAB / 2 - 800,
    top: FAB / 2 - 800,
    backgroundColor: '#000',
  },
  fab: {
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  petal: {
    position: 'absolute',
    width: PETAL,
    height: PETAL,
    borderRadius: PETAL / 2,
    // Centered on the FAB; transforms fly it out to its orbit slot.
    left: (FAB - PETAL) / 2,
    top: (FAB - PETAL) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 8,
  },
  tooltipWrap: {
    position: 'absolute',
    top: -(RADIUS + 58),
    left: -120,
    right: -120,
    alignItems: 'center',
  },
  tooltip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  tooltipText: {
    color: theme.colors.text.primary,
    fontSize: 13,
    fontWeight: theme.typography.fontWeight.semibold,
  },
});

export default OrbitFAB;
