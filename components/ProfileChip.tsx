// components/ProfileChip.tsx
//
// The Dashboard's top-left identity: the user's Nostr avatar, a short welcome
// line and, under it, their name. Tapping it opens the profile editor, or Nostr
// setup when there is no identity yet.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import type { NostrProfile } from '../services/NostrService';
import { profileDisplayName } from '../utils/nostrProfile';
import { ProfileAvatar } from './ProfileAvatar';

interface Props {
  profile?: NostrProfile | null;
  hasIdentity: boolean;
  /** Small welcome line above the name, e.g. "Good morning". */
  greeting?: string;
  onPress: () => void;
}

export function ProfileChip({ profile, hasIdentity, greeting, onPress }: Props) {
  const name = profileDisplayName(profile);
  const title = name || (hasIdentity ? 'Add your name' : 'Set up profile');

  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={hasIdentity ? `${title}. Edit profile` : 'Set up your profile'}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      <ProfileAvatar uri={profile?.picture} name={name} size={40} />
      <View style={styles.text}>
        {!!greeting && <Text style={styles.greeting} numberOfLines={1}>{greeting}</Text>}
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{title}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.text.tertiary} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], alignSelf: 'flex-start', maxWidth: '100%' },
  text: { flexShrink: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: {
    flexShrink: 1,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    letterSpacing: -0.3,
    color: theme.colors.text.primary,
  },
  greeting: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.secondary,
    marginBottom: 2,
  },
});
