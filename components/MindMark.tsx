// components/MindMark.tsx
//
// Single source of truth for the KaleidoMind visual identity, so the symbol is
// identical everywhere it appears (chat avatar, voice overlay header + orb-area,
// the "thinking on-device" row, headers). Previously each surface hand-rolled an
// Ionicons "sparkles" with its own size/color, which drifted.
//
//  - <MindGlyph/>  : just the sparkle, in brand green (or a passed color).
//  - <MindAvatar/> : the gradient disc + sparkle used wherever KaleidoMind needs
//                    an "avatar" (chat assistant rows, the voice header chip).
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

/**
 * The KaleidoMind mark — the SAME "brain" glyph the bottom-nav Mind tab uses, so
 * the screen header, voice header and chat avatar all match the navbar identity
 * (previously a "sparkles" icon that drifted from the tab).
 */
export const MindGlyph: React.FC<{
  size?: number;
  color?: string;
}> = ({ size = 18, color = theme.colors.primary[500] }) => (
  <MaterialCommunityIcons name="brain" size={size} color={color} />
);

/** A gradient disc carrying the sparkle — the KaleidoMind "avatar". */
export const MindAvatar: React.FC<{
  size?: number;
  style?: StyleProp<ViewStyle>;
}> = ({ size = 32, style }) => {
  const gradient = theme.colors.primary.gradient ?? [theme.colors.primary[500], theme.colors.primary[500]];
  return (
    <LinearGradient
      colors={gradient as [string, string]}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <MindGlyph size={Math.round(size * 0.52)} color={theme.colors.text.inverse} />
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
});

export default MindAvatar;
