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
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const dot = (offsetPhase: [number, number, number]) => ({
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 2,
    backgroundColor: theme.colors.primary[500],
    opacity: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: offsetPhase }),
  });

  return (
    <View style={styles.row}>
      <Animated.View style={dot([0.3, 1, 0.3])} />
      <Animated.View style={dot([1, 0.3, 1])} />
      <Animated.View style={dot([0.3, 1, 0.3])} />
      {label ? (
        <Text style={[styles.label, { color: theme.colors.text.tertiary }]}>{label}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 13, fontStyle: 'italic', marginLeft: 8 },
});

export default TypingDots;
