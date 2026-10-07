// components/ProfileAvatar.tsx
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { profileInitials } from '../utils/nostrProfile';

interface Props {
  uri?: string | null;
  name?: string;
  size?: number;
}

/** A round Nostr avatar: the picture, else initials, else a person icon. */
export function ProfileAvatar({ uri, name = '', size = 40 }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const initials = profileInitials(name);
  const round = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.avatar, round]}>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={round}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : initials ? (
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}>{initials}</Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.5)} color={theme.colors.primary[500]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${theme.colors.primary[500]}29`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  initials: {
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.primary[500],
  },
});
