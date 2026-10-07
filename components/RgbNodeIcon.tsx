// components/RgbNodeIcon.tsx
//
// The RGB logo with a small lightning-bolt badge: the RGB Lightning Node.
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { RgbIcon } from './ProtocolIcons';

export function RgbNodeIcon({ size = 24 }: { size?: number }) {
  const badge = Math.max(10, Math.round(size * 0.5));
  return (
    <View style={{ width: size, height: size }}>
      <RgbIcon size={size} />
      <View style={{
        position: 'absolute', right: -badge * 0.25, bottom: -badge * 0.25, width: badge, height: badge, borderRadius: badge / 2,
        backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name="flash" size={badge * 0.75} color={theme.colors.warning[500]} />
      </View>
    </View>
  );
}
