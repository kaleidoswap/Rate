// screens/ProfileScreen.tsx
//
// The user's Nostr profile as others see it, opened from the Dashboard: banner,
// photo, names and links, plus a QR of the npub that friends scan to add them.
// Editing happens one step further, on ProfileEdit.
import React, { useEffect, useMemo } from 'react';
import { Image, Linking, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nip19 } from 'nostr-tools';
import { theme } from '../theme';
import { Button, CopyButton, EmptyState } from '../components';
import { ScreenHeader } from '../components/ScreenHeader';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ReceiveQr } from '../components/receive/ReceiveQr';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loadNostrProfile } from '../store/slices/nostrSlice';
import { formatNip05, isHttpUrl, profileDisplayName, shortNpub } from '../utils/nostrProfile';

interface Props {
  navigation: any;
}

function npubOf(npub: string | null, publicKey: string | null): string {
  if (npub) return npub;
  if (!publicKey) return '';
  try { return nip19.npubEncode(publicKey); } catch { return ''; }
}

export default function ProfileScreen({ navigation }: Props) {
  const dispatch = useAppDispatch();
  const profile = useAppSelector(s => s.nostr?.profile ?? null);
  const publicKey = useAppSelector(s => s.nostr?.publicKey ?? null);
  const storedNpub = useAppSelector(s => s.nostr?.npub ?? null);
  const isConnected = useAppSelector(s => !!s.nostr?.isConnected);
  const npub = useMemo(() => npubOf(storedNpub, publicKey), [storedNpub, publicKey]);

  useEffect(() => {
    if (isConnected) dispatch(loadNostrProfile());
  }, [dispatch, isConnected]);

  if (!publicKey || !npub) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Profile" showBack />
        <EmptyState
          icon="person-circle-outline"
          title="No Nostr profile yet"
          message="Create or import a Nostr identity to get a profile your contacts can see."
          actionLabel="Set up Nostr"
          onAction={() => navigation.replace('NostrSettings')}
        />
      </View>
    );
  }

  const name = profileDisplayName(profile);
  const username = (profile?.name ?? '').trim();
  const nip05 = formatNip05(profile?.nip05);
  const about = (profile?.about ?? '').trim();
  const lud16 = (profile?.lud16 ?? '').trim();
  const website = (profile?.website ?? '').trim();
  const banner = (profile?.banner ?? '').trim();
  const picture = (profile?.picture ?? '').trim();
  const code = `nostr:${npub}`;

  const share = () => {
    Share.share({ message: `Add me on Nostr: ${code}`, title: 'My Nostr profile' }).catch(() => undefined);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Profile" showBack />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.banner}>
            {isHttpUrl(banner) && <Image source={{ uri: banner }} style={styles.bannerImg} resizeMode="cover" />}
          </View>
          <View style={styles.avatarWrap}>
            <ProfileAvatar uri={isHttpUrl(picture) ? picture : null} name={name} size={AVATAR} />
          </View>
        </View>

        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={2}>{name || 'No name yet'}</Text>
          {!!username && username !== name && <Text style={styles.username} numberOfLines={1}>@{username}</Text>}
          {!!nip05 && (
            <View style={styles.inline}>
              <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary[500]} />
              <Text style={styles.meta} numberOfLines={1}>{nip05}</Text>
            </View>
          )}
          {!!about && <Text style={styles.about}>{about}</Text>}
        </View>

        {(!!lud16 || !!website) && (
          <View style={styles.card}>
            {!!lud16 && (
              <View style={[styles.row, !!website && styles.rowDivider]}>
                <Ionicons name="flash" size={16} color={theme.colors.warning[500]} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Lightning address</Text>
                  <Text style={styles.rowValue} numberOfLines={1}>{lud16}</Text>
                </View>
                <CopyButton value={lud16} size={16} />
              </View>
            )}
            {!!website && (
              <TouchableOpacity
                style={styles.row}
                disabled={!isHttpUrl(website)}
                onPress={() => Linking.openURL(website).catch(() => undefined)}
                accessibilityRole="link"
                accessibilityLabel={`Website ${website}`}
              >
                <Ionicons name="globe-outline" size={16} color={theme.colors.text.secondary} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Website</Text>
                  <Text style={styles.rowValue} numberOfLines={1}>{website.replace(/^https?:\/\//i, '')}</Text>
                </View>
                {isHttpUrl(website) && <Ionicons name="open-outline" size={16} color={theme.colors.text.tertiary} />}
              </TouchableOpacity>
            )}
          </View>
        )}

        <Button title="Edit profile" variant="secondary" onPress={() => navigation.navigate('ProfileEdit')} />

        <View style={[styles.card, styles.qrCard]}>
          <Text style={styles.qrTitle}>Your Nostr code</Text>
          <Text style={styles.qrHint}>Friends can scan this to add you</Text>
          <ReceiveQr value={code} size={QR} label="Nostr code" />
          <Text style={styles.npub} numberOfLines={1} selectable>{shortNpub(npub)}</Text>
          <View style={styles.qrActions}>
            <CopyButton value={npub} label="Copy" size={16} color={theme.colors.primary[500]} />
            <TouchableOpacity style={styles.share} onPress={share} accessibilityRole="button" accessibilityLabel="Share">
              <Ionicons name="share-outline" size={16} color={theme.colors.primary[500]} />
              <Text style={styles.shareText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const AVATAR = 88;
const QR = 200;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.secondary },
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  hero: { marginBottom: AVATAR / 2 - theme.spacing[2] },
  banner: {
    height: 120,
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  bannerImg: { width: '100%', height: '100%' },
  avatarWrap: {
    position: 'absolute',
    left: theme.spacing[4],
    bottom: -AVATAR / 2,
    borderRadius: AVATAR / 2 + 3,
    borderWidth: 3,
    borderColor: theme.colors.background.secondary,
  },
  identity: { gap: theme.spacing[1] },
  name: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: theme.typography.fontWeight.bold,
    letterSpacing: -0.4,
    color: theme.colors.text.primary,
  },
  username: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  inline: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
  meta: { flexShrink: 1, fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  about: {
    marginTop: theme.spacing[2],
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
  },
  card: {
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    minHeight: 56,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.light },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
  rowValue: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.primary, fontWeight: theme.typography.fontWeight.medium },
  qrCard: { alignItems: 'center', padding: theme.spacing[5], gap: theme.spacing[2] },
  qrTitle: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.primary },
  qrHint: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, marginBottom: theme.spacing[2] },
  npub: { marginTop: theme.spacing[1], fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  qrActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[6] },
  share: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1.5], minHeight: 44, minWidth: 44 },
  shareText: { fontSize: theme.typography.fontSize.sm, color: theme.colors.primary[500] },
});
