// components/Sheet.tsx
//
// The one bottom sheet. The backdrop fades, the sheet springs up from the
// bottom, and it follows the finger when dragged down by its handle or header:
// a short fast flick or a drag past a third of its height dismisses it. It
// animates out before calling onClose, so every sheet leaves the same way it
// arrived. Respects the system "Reduce motion" setting. It rides above the
// keyboard: edge-to-edge Android doesn't resize a modal for it, and iOS
// padding doesn't move an absolutely positioned sheet.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Keyboard, Platform, StyleProp, ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme, motion } from '../theme';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** A line under the title. */
  subtitle?: string;
  children: React.ReactNode;
  /** Fixed content under the scrolling body, e.g. the primary action. */
  footer?: React.ReactNode;
  /** Take most of the screen (lists, search). Default: fit the content. */
  tall?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const OFFSCREEN = 900;

export function Sheet({ visible, onClose, title, subtitle, children, footer, tall, style, testID }: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(OFFSCREEN);
  const fade = useSharedValue(0);
  const height = useSharedValue(OFFSCREEN);
  const keyboard = useKeyboardHeight(mounted);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      fade.value = withTiming(1, { duration: motion.duration.base });
      y.value = reduceMotion ? 0 : withSpring(0, motion.spring);
    } else if (mounted) {
      fade.value = withTiming(0, { duration: motion.duration.fast });
      y.value = withTiming(reduceMotion ? 0 : height.value, { duration: motion.duration.base }, done => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const drag = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate(e => { y.value = Math.max(0, e.translationY); })
    .onEnd(e => {
      // Settle back either way: a sheet that refuses to close (e.g. while a
      // payment is sending) must not stay half-dragged. When the parent does
      // close it, the exit animation takes over from here.
      if (e.translationY > height.value / 3 || e.velocityY > 900) runOnJS(onClose)();
      y.value = withSpring(0, motion.spring);
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        <View style={styles.fill}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
            <TouchableOpacity style={styles.fill} activeOpacity={1} onPress={onClose}
              accessibilityRole="button" accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View testID={testID}
            onLayout={e => { height.value = e.nativeEvent.layout.height; }}
            style={[styles.sheet, tall && styles.tall, keyboard > 0
              ? { bottom: keyboard, maxHeight: '85%', paddingBottom: theme.spacing[4] }
              : { paddingBottom: Math.max(insets.bottom, theme.spacing[4]) }, style, sheetStyle]}>
            <GestureDetector gesture={drag}>
              <View>
                <View style={styles.handle} />
                {!!title && <View style={styles.header}>
                  <View style={styles.fill}>
                    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
                    {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
                  </View>
                  <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Ionicons name="close" size={20} color={theme.colors.text.secondary} />
                  </TouchableOpacity>
                </View>}
              </View>
            </GestureDetector>
            <View style={tall ? styles.fill : styles.shrink}>{children}</View>
            {footer}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** The on-screen keyboard's height while it is shown (0 when hidden). */
function useKeyboardHeight(active: boolean): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!active) { setH(0); return; }
    const ios = Platform.OS === 'ios';
    const subs = [
      Keyboard?.addListener?.(ios ? 'keyboardWillShow' : 'keyboardDidShow', e => setH(e.endCoordinates?.height ?? 0)),
      Keyboard?.addListener?.(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0)),
    ];
    return () => subs.forEach(sub => sub?.remove());
  }, [active]);
  return h;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Lets a ScrollView inside a fit-to-content sheet stop at the sheet's max height.
  shrink: { flexShrink: 1 },
  backdrop: { backgroundColor: theme.colors.background.backdrop },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '90%',
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[2],
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: theme.colors.border.light,
  },
  tall: { height: '88%' },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border.medium,
    marginBottom: theme.spacing[3],
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.spacing[3] },
  title: { fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  subtitle: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.tertiary, marginTop: 2 },
  close: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: theme.spacing[3],
  },
});

export default Sheet;
