import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A single selectable action on the orbit. */
export interface OrbitAction {
  key: string;
  /** Short name shown in the hover tooltip while sliding. */
  label: string;
  /** Accent color — used for the petal fill, border and glow. */
  color: string;
  /** Icon node, rendered on the petal. */
  renderIcon: () => React.ReactNode;
  /** Fired when this petal is chosen. */
  onSelect: () => void;
}

interface OrbitFABProps {
  /** Icon for the resting center button (e.g. the brand mark). */
  renderCenterIcon: () => React.ReactNode;
  /** Petals, laid out across the fan in array order. Keep to ~2–5. */
  actions: OrbitAction[];
  /**
   * Arc the petals fan across, in degrees (up = 90, right = 0, left = 180).
   * Defaults to a symmetric 150°→30°. Pass a right-leaning range to cluster the
   * petals under the right thumb — e.g. arcStart={82} arcEnd={14}. actions[0]
   * sits at `arcStart`, the last action at `arcEnd`.
   */
  arcStart?: number;
  arcEnd?: number;
  /** Action key fired on a DOUBLE-TAP of the center button (shortcut). */
  doubleTapKey?: string;
  /** Action key fired on a PRESS-AND-HOLD of the center button (shortcut). */
  holdKey?: string;
}

const FAB = 68;
const PETAL = 52;
const RADIUS = 96;            // center-to-petal distance
const SCRIM = 1600;           // full-screen tap/dim layer, centered on the FAB
const DEAD_ZONE = 36;         // finger this close to center → no selection (cancel region)
const SELECT_SLOP = 46;       // max angular distance (deg) from a petal to capture it
const SPRING = { damping: 14, stiffness: 180, mass: 0.6 } as const;

// Gesture disambiguation thresholds. The key invariant the design calls for:
// a press held STILL fires the hold action (mic), but a press that SLIDES must
// open the menu and select — never the hold action. We get that for free from
// the gesture engine: LongPress fails the moment the finger travels more than
// HOLD_MAX_MOVE, and Pan only begins once it travels SLIDE_MIN — so any real
// slide cancels the hold before it can fire.
const TAP_MAX_MS = 260;       // a press longer than this is no longer a tap…
const HOLD_MS = 380;          // …and a still press this long → the hold action
const HOLD_MAX_MOVE = 14;     // moving more than this aborts the hold (→ slide)
const SLIDE_MIN = 18;         // finger must travel this far to start a slide-select

/**
 * Expandable radial "orbit" FAB with a four-way gesture vocabulary:
 *
 *   • double-tap         → the `doubleTapKey` action (e.g. Scan)
 *   • press & hold still  → the `holdKey` action (e.g. Voice/mic)
 *   • single tap          → fan the menu out and PIN it open (tap again to close)
 *   • press & slide       → fan out and select by sliding toward a petal, release
 *                           to fire — all in one motion, no lift required
 *
 * Selection rides a single Pan whose touch is tracked screen-wide, so the petals
 * need no per-petal hit-boxes (which keeps them reliable on Android even though
 * they render outside the tab-bar bounds).
 */
export const OrbitFAB: React.FC<OrbitFABProps> = ({
  renderCenterIcon,
  actions,
  arcStart = 150,
  arcEnd = 30,
  doubleTapKey,
  holdKey,
}) => {
  const progress = useSharedValue(0); // 0 = closed, 1 = fully fanned out
  const sel = useSharedValue(-1);     // currently highlighted petal index
  const [mounted, setMounted] = useState(false); // overlay mounted only while active
  const [pinned, setPinned] = useState(false);    // menu held open after a tap
  const [hovered, setHovered] = useState(-1);     // mirror of sel for the tooltip

  // Fan from arcStart → arcEnd; a single action sits at the arc midpoint.
  const positions = useMemo(() => {
    const n = actions.length;
    const span = arcStart - arcEnd;
    return actions.map((_, i) => {
      const angle = n <= 1 ? arcStart - span / 2 : arcStart - i * (span / (n - 1));
      const rad = (angle * Math.PI) / 180;
      return { angle, x: RADIUS * Math.cos(rad), y: -RADIUS * Math.sin(rad) };
    });
  }, [actions.length, arcStart, arcEnd]);
  const angles = useMemo(() => positions.map((p) => p.angle), [positions]);

  // Small shortcut legend shown above the open menu (when no petal is hovered),
  // so the gesture vocabulary is discoverable without cluttering the resting bar.
  const shortcutHints = useMemo(() => {
    const labelFor = (k?: string) => actions.find((a) => a.key === k)?.label;
    return [
      { gesture: 'Double-tap', label: labelFor(doubleTapKey) },
      { gesture: 'Hold', label: labelFor(holdKey) },
      { gesture: 'Slide', label: 'pick' },
    ].filter((h) => !!h.label) as { gesture: string; label: string }[];
  }, [actions, doubleTapKey, holdKey]);

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

  // JS-thread twin of pickIndex for a discrete tap on the scrim. Lets a tap
  // TOWARD a petal select it (the petals themselves can't be hit-tested where
  // they render outside the bar on Android), so the pinned menu is tappable and
  // not just slide-driven. A tap in the dead zone / away from any petal closes.
  const directionToIndex = (dx: number, dy: number): number => {
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < DEAD_ZONE) return -1;
    const ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
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

  // --- JS-thread helpers (called from runOnJS or from runOnJS(true) gestures) ---
  const onHover = (idx: number) => {
    setHovered(idx);
    if (idx >= 0) feedback.select();
  };

  const fireIndex = (idx: number) => {
    if (idx >= 0 && idx < actions.length) {
      // Same light press noise as the Receive/Swap/Send tiles — no celebratory
      // "bell" chime just for opening a quick action.
      feedback.tap();
      actions[idx].onSelect();
    }
  };

  const fireKey = (key?: string) => {
    const a = key ? actions.find((x) => x.key === key) : undefined;
    if (a) {
      feedback.tap();
      a.onSelect();
    }
  };

  const closeMenu = () => {
    progress.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }, (finished) => {
      'worklet';
      if (finished) runOnJS(setMounted)(false);
    });
    sel.value = -1;
    setHovered(-1);
    setPinned(false);
  };

  const pinOpen = () => {
    feedback.tap();
    setMounted(true);
    setPinned(true);
    cancelAnimation(progress);
    progress.value = withSpring(1, SPRING);
  };

  // --- Gestures ---------------------------------------------------------------
  // Shortcut: double-tap → doubleTapKey action.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(TAP_MAX_MS)
    .runOnJS(true)
    .onStart(() => {
      closeMenu();
      fireKey(doubleTapKey);
    });

  // Single tap → toggle the pinned menu.
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(TAP_MAX_MS)
    .runOnJS(true)
    .onStart(() => {
      if (pinned) closeMenu();
      else pinOpen();
    });

  // Press & hold STILL → holdKey action. maxDistance aborts the hold the instant
  // the finger slides, so a hold-into-slide never fires this.
  const longPress = Gesture.LongPress()
    .minDuration(HOLD_MS)
    .maxDistance(HOLD_MAX_MOVE)
    .runOnJS(true)
    .onStart(() => {
      closeMenu();
      fireKey(holdKey);
    });

  // Press & slide → fan out and select by direction; release fires the petal.
  const pan = Gesture.Pan()
    .minDistance(SLIDE_MIN)
    .maxPointers(1)
    .shouldCancelWhenOutside(false)
    .onStart(() => {
      cancelAnimation(progress);
      progress.value = withSpring(1, SPRING);
      runOnJS(setMounted)(true);
    })
    .onUpdate((e) => {
      if (progress.value > 0.15) {
        const idx = pickIndex(e.translationX, e.translationY);
        if (idx !== sel.value) {
          sel.value = idx;
          runOnJS(onHover)(idx);
        }
      }
    })
    .onEnd(() => {
      const chosen = sel.value;
      if (chosen >= 0) runOnJS(fireIndex)(chosen);
    })
    .onFinalize(() => {
      // A slide always resolves the menu (fired above, or dismissed here).
      runOnJS(closeMenu)();
    });

  // double-tap wins over single-tap; hold and slide race the taps on their own
  // activation conditions (time held still vs. distance travelled).
  const gesture = Gesture.Race(Gesture.Exclusive(doubleTap, singleTap), longPress, pan);

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
          {/* Tap toward a petal to select it; tap the center/away to close.
              (The scrim is centered on the FAB, so locationX/Y − SCRIM/2 is the
              offset from the button center.) */}
          <AnimatedPressable
            style={[styles.scrim, scrimStyle]}
            onPress={(e) => {
              const idx = directionToIndex(
                e.nativeEvent.locationX - SCRIM / 2,
                e.nativeEvent.locationY - SCRIM / 2,
              );
              if (idx >= 0) fireIndex(idx);
              closeMenu();
            }}
            accessibilityLabel="Quick actions — tap an action or tap away to close"
          />
          {actions.map((a, i) => (
            <Petal key={a.key} index={i} pos={positions[i]} color={a.color} progress={progress} sel={sel}>
              {a.renderIcon()}
            </Petal>
          ))}
          <Animated.View style={[styles.tooltipWrap, tooltipStyle]} pointerEvents="none">
            {hovered >= 0 ? (
              <View style={styles.tooltip}>
                <Text style={styles.tooltipText}>{actions[hovered].label}</Text>
              </View>
            ) : (
              shortcutHints.length > 0 && (
                <View style={styles.legend}>
                  {shortcutHints.map((h, i) => (
                    <React.Fragment key={h.gesture}>
                      {i > 0 && <Text style={styles.legendDivider}>·</Text>}
                      <Text style={styles.legendText}>
                        <Text style={styles.legendGesture}>{h.gesture}</Text>
                        {` ${h.label}`}
                      </Text>
                    </React.Fragment>
                  ))}
                </View>
              )
            )}
          </Animated.View>
        </>
      )}

      <GestureDetector gesture={gesture}>
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
  // the active gesture owns the touch stream, so the scrim never intercepts.
  scrim: {
    position: 'absolute',
    width: SCRIM,
    height: SCRIM,
    left: FAB / 2 - SCRIM / 2,
    top: FAB / 2 - SCRIM / 2,
    backgroundColor: '#000',
  },
  fab: {
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    // No disc/circle behind the mark — the multi-color K stands on its own for a
    // cleaner read against the dark UI. Transparent fill, no border, no glow.
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
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
    top: -(RADIUS + 42),
    left: -140,
    right: -140,
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
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(18,20,30,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  legendText: {
    color: theme.colors.text.secondary,
    fontSize: 11,
  },
  legendGesture: {
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  legendDivider: {
    color: theme.colors.text.tertiary,
    fontSize: 11,
  },
});

export default OrbitFAB;
