import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { theme } from '../../theme';

interface VoiceAgentFABProps {
  onPress: () => void;
  /** Bottom offset so it floats above the tab bar. */
  bottom?: number;
  right?: number;
}

/**
 * Floating "Talk to KaleidoMind" button. A gently breathing brand-green orb
 * with a halo, inviting a tap to start a voice conversation with the agent.
 */
export const VoiceAgentFAB: React.FC<VoiceAgentFABProps> = ({ onPress, bottom = 96, right = 18 }) => {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, []);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.35, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.9, 1.6]) }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.06]) }],
  }));

  return (
    <View style={[styles.wrap, { bottom, right }]} pointerEvents="box-none">
      <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none" />
      <Animated.View style={coreStyle}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel="Talk to KaleidoMind"
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.9 }]}
        >
          <Ionicons name="mic" size={26} color={theme.colors.text.inverse} />
        </Pressable>
      </Animated.View>
    </View>
  );
};

const SIZE = 60;
const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  halo: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: theme.colors.primary[500],
  },
  fab: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
});

export default VoiceAgentFAB;
