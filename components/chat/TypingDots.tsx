// components/chat/TypingDots.tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';

interface TypingDotsProps {
  /** Optional caption shown next to the dots (e.g. "Thinking on-device…"). */
  label?: string;
}

/**
 * Single, theme-aware animated three-dot indicator used both for the inline
 * streaming placeholder and the standalone "AI is processing" row. Replaces the
 * two divergent implementations that previously lived in AIAssistantScreen.
 */
const TypingDots: React.FC<TypingDotsProps> = ({ label }) => {
  const theme = useAppTheme();
  // One animated value per dot, started on a stagger so the dots bounce in a
  // travelling wave (smoother + more "alive" than the old two-phase blink).
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    const make = (v: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 420, useNativeDriver: true }),
          Animated.delay(240),
        ]),
      );
    const loops = dots.map(make);
    const timers = dots.map((_, i) => setTimeout(() => loops[i].start(), i * 160));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [dots]);

  return (
    <View style={styles.row}>
      <View style={styles.dotsRow}>
        {dots.map((v, i) => (
          <Animated.View
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: 3.5,
              marginHorizontal: 2.5,
              backgroundColor: theme.colors.primary[400] ?? theme.colors.primary[500],
              opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
                { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] }) },
              ],
            }}
          />
        ))}
      </View>
      {label ? (
        <Text style={[styles.label, { color: theme.colors.text.secondary }]}>{label}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dotsRow: { flexDirection: 'row', alignItems: 'center', height: 12 },
  label: { fontSize: 13, marginLeft: 10, fontWeight: '500' },
});

export default TypingDots;
