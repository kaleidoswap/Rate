import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { theme } from '../../theme';

export type MindMood =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'concerned'
  | 'sleeping';

export interface MindCharacterProps {
  mood?: MindMood;
  size?: number;
  level?: number;
  onPress?: () => void;
}

const MOOD_COLOR: Record<MindMood, string> = {
  idle: theme.colors.primary[500],
  listening: theme.colors.info[500],
  thinking: theme.colors.primary[500],
  speaking: theme.colors.primary[500],
  happy: theme.colors.success[500],
  concerned: theme.colors.warning[500],
  sleeping: theme.colors.text.tertiary,
};

export const MindCharacter: React.FC<MindCharacterProps> = ({
  mood = 'idle',
  size = 48,
  onPress,
}) => {
  const eye = Math.max(3, Math.round(size / 9));
  const body = (
    <View
      testID="mind-character"
      accessibilityLabel={`Prismo, ${mood}`}
      style={[
        styles.body,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: MOOD_COLOR[mood],
        },
      ]}
    >
      <View style={[styles.eyes, { gap: eye * 1.5 }]}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={{
              width: eye,
              height: mood === 'sleeping' ? Math.max(1, eye / 3) : eye,
              borderRadius: eye / 2,
              backgroundColor: theme.colors.background.primary,
            }}
          />
        ))}
      </View>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
};

export const MindCharacterBadge: React.FC<Omit<MindCharacterProps, 'size'>> = (
  props
) => <MindCharacter {...props} size={24} />;

const styles = StyleSheet.create({
  body: { alignItems: 'center', justifyContent: 'center' },
  eyes: { flexDirection: 'row' },
});

export default MindCharacter;
