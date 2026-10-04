// components/SegmentedControl.tsx
//
// A two-to-four way switch for changing how a screen is organised (not for
// filtering — that's SegmentedTabs). A thumb slides under the chosen option.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { theme, motion } from '../theme';
import { feedback } from '../utils/feedback';

export interface ControlOption<T extends string> {
  key: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SegmentedControlProps<T extends string> {
  options: ControlOption<T>[];
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const INSET = 3;

export function SegmentedControl<T extends string>({ options, value, onChange, style, accessibilityLabel }: SegmentedControlProps<T>) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex(o => o.key === value));
  const segment = width > 0 ? (width - INSET * 2) / options.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    x.value = withSpring(index * segment, motion.spring);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, segment]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      style={[styles.track, style]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {segment > 0 && <Animated.View pointerEvents="none" style={[styles.thumb, { width: segment }, thumbStyle]} />}
      {options.map(option => {
        const active = option.key === value;
        const color = active ? theme.colors.text.primary : theme.colors.text.secondary;
        return (
          <Pressable
            key={option.key}
            style={styles.option}
            onPress={() => { if (!active) { feedback.select(); onChange(option.key); } }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            {option.icon && <Ionicons name={option.icon} size={15} color={active ? theme.colors.primary[500] : color} />}
            <Text style={[styles.label, { color }]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: INSET,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  thumb: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: INSET,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  option: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
  },
  label: { fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
});

export default SegmentedControl;
