import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
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
  label: string;
  color: string;
  renderIcon: () => React.ReactNode;
  onSelect: () => void;
}

interface OrbitFABProps {
  /** Icon for the resting center button (e.g. the brand mark). */
  renderCenterIcon: () => React.ReactNode;
  /** Petals, laid out across the fan in array order. Keep to ~2–5. */
  actions: OrbitAction[];
  /**
   * Arc the petals fan across, in degrees (up = 90, right = 0, left = 180).
   * actions[0] sits at `arcStart`, the last action at `arcEnd`.
   */
  arcStart?: number;
  arcEnd?: number;
  /** Action key fired on a DOUBLE-TAP of the center button (shortcut). */
  doubleTapKey?: string;
  /** Action key fired on a PRESS-AND-HOLD of the center button (shortcut). */
  holdKey?: string;
}

const FAB = 68;
const PETAL = 56;
const RADIUS = 108;       // center-to-petal distance
const WRAP_W = 92;        // petal+label hit target width
const SPRING = { damping: 14, stiffness: 170, mass: 0.6 } as const;
const TAP_MAX_MS = 260;   // a press longer than this isn't a tap…
const HOLD_MS = 360;      // …and a still press this long → the hold action
const HOLD_MAX_MOVE = 14; // moving more than this aborts the hold

/**
 * Expandable radial "orbit" FAB.
 *
 *   • single tap          → fan the menu open
 *   • tap a petal          → run that action and close
 *   • tap the button again OR anywhere outside → close
 *   • double-tap           → the `doubleTapKey` shortcut (e.g. Scan)
 *   • press & hold still    → the `holdKey` shortcut (e.g. Voice/mic)
 *
 * The open menu lives in a full-screen Modal so the scrim reliably catches
 * outside taps and the petals are directly tappable on every platform. The
 * petals are positioned from the button's measured on-screen center.
 */
export const OrbitFAB: React.FC<OrbitFABProps> = ({
  renderCenterIcon,
  actions,
  arcStart = 150,
  arcEnd = 30,
  doubleTapKey,
  holdKey,
}) => {
  const rootRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [center, setCenter] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const progress = useSharedValue(0);

  // Mirror `open` into a ref so gesture closures read the live value.
  const openRef = useRef(open);
  openRef.current = open;

  const positions = useMemo(() => {
    const n = actions.length;
    const span = arcStart - arcEnd;
    return actions.map((_, i) => {
      const angle = n <= 1 ? arcStart - span / 2 : arcStart - i * (span / (n - 1));
      const rad = (angle * Math.PI) / 180;
      return { x: RADIUS * Math.cos(rad), y: -RADIUS * Math.sin(rad) };
    });
  }, [actions.length, arcStart, arcEnd]);

  const close = useCallback(() => {
    progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (finished) => {
      'worklet';
      if (finished) runOnJS(setOpen)(false);
    });
  }, [progress]);

  const openMenu = useCallback(() => {
    const node = rootRef.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => {
      setCenter({ x: x + w / 2, y: y + h / 2 });
      setOpen(true);
      progress.value = withSpring(1, SPRING);
      feedback.tap();
    });
  }, [progress]);

  const fireKey = useCallback(
    (key?: string) => {
      const a = key ? actions.find((x) => x.key === key) : undefined;
      if (a) {
        feedback.success();
        a.onSelect();
      }
    },
    [actions],
  );

  // single tap → toggle; double-tap / long-press → shortcuts. double-tap wins
  // over single (Exclusive); a still hold beats a quick tap (Race).
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(TAP_MAX_MS)
    .runOnJS(true)
    .onStart(() => {
      if (openRef.current) close();
      fireKey(doubleTapKey);
    });
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(TAP_MAX_MS)
    .runOnJS(true)
    .onStart(() => {
      if (openRef.current) close();
      else openMenu();
    });
  const longPress = Gesture.LongPress()
    .minDuration(HOLD_MS)
    .maxDistance(HOLD_MAX_MOVE)
    .runOnJS(true)
    .onStart(() => {
      if (openRef.current) close();
      fireKey(holdKey);
    });
  const gesture = Gesture.Exclusive(doubleTap, Gesture.Race(longPress, singleTap));

  const fabAnim = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.04 * progress.value }] }));
  const scrimAnim = useAnimatedStyle(() => ({ opacity: progress.value * 0.5 }));
  const replicaAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: center.x - FAB / 2 }, { translateY: center.y - FAB / 2 }],
  }));

  return (
    <View ref={rootRef} collapsable={false} style={styles.root}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.fab, fabAnim]} accessibilityRole="button" accessibilityLabel="Quick actions">
          {renderCenterIcon()}
        </Animated.View>
      </GestureDetector>

      <Modal visible={open} transparent statusBarTranslucent animationType="none" onRequestClose={close}>
        {/* Dim layer (visual only) under the tap-catching scrim. */}
        <Animated.View style={[styles.scrim, scrimAnim]} pointerEvents="none" />
        {/* Tap anywhere outside a petal → close. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close quick actions">
          {actions.map((a, i) => (
            <Petal
              key={a.key}
              center={center}
              pos={positions[i]}
              color={a.color}
              label={a.label}
              progress={progress}
              onPress={() => {
                feedback.success();
                a.onSelect();
                close();
              }}
            >
              {a.renderIcon()}
            </Petal>
          ))}
          {/* Center mark replica so petals fan from the visible button; tapping
              it falls through to the scrim → close ("tap it again to close"). */}
          <Animated.View style={[styles.replica, replicaAnim]} pointerEvents="none">
            {renderCenterIcon()}
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
};

interface PetalProps {
  center: { x: number; y: number };
  pos: { x: number; y: number };
  color: string;
  label: string;
  progress: SharedValue<number>;
  onPress: () => void;
  children: React.ReactNode;
}

const Petal: React.FC<PetalProps> = ({ center, pos, color, label, progress, onPress, children }) => {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: Math.min(1, p * 1.6),
      transform: [
        { translateX: center.x - WRAP_W / 2 + pos.x * p },
        { translateY: center.y - PETAL / 2 + pos.y * p },
        { scale: 0.5 + 0.5 * p },
      ],
    };
  });

  return (
    <AnimatedPressable style={[styles.petalWrap, style]} onPress={onPress} accessibilityLabel={label}>
      <View style={[styles.petal, { backgroundColor: color }]}>{children}</View>
      <Text style={styles.petalLabel} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  root: {
    width: FAB,
    height: FAB,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    // White fill so the multi-color K mark reads; neutral drop shadow (no glow).
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  replica: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  petalWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: WRAP_W,
    alignItems: 'center',
  },
  petal: {
    width: PETAL,
    height: PETAL,
    borderRadius: PETAL / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  petalLabel: {
    marginTop: 6,
    color: theme.colors.text.primary,
    fontSize: 12,
    fontWeight: theme.typography.fontWeight.semibold,
  },
});

export default OrbitFAB;
