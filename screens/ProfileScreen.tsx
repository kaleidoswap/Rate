// screens/ProfileScreen.tsx
//
// The user's Nostr profile as others see it, opened from the Dashboard: banner,
// photo, names and links, plus a QR of the npub that friends scan to add them.
// Editing happens one step further, on ProfileEdit; relays and keys live in
// Nostr settings (the only settings entry kept here).
import React, { useEffect, useMemo } from 'react';
import { Image, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { nip19 } from 'nostr-tools';
import { leading } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';
import { Badge, Card, CopyButton, Divider, EmptyState, SectionHeader } from '../components';
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
  const theme = useAppTheme();
  const styles = makeStyles(theme);
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
  const banner = (profile?.banner ?? '').trim();
  const picture = (profile?.picture ?? '').trim();
  const code = `nostr:${npub}`;

  const share = () => {
    Share.share({ message: `Add me on Nostr: ${code}`, title: 'My Nostr profile' }).catch(() => undefined);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Profile" showBack rightAction={
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit profile"
          onPress={() => navigation.navigate('ProfileEdit')} style={styles.editAction}>
          <Ionicons name="create-outline" size={18} color={theme.colors.primary[500]} />
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      } />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Identity: banner, centred avatar, names, NIP-05 and bio */}
        <View style={styles.hero}>
          <View style={styles.banner}>
            <LinearGradient
              colors={[theme.colors.surface.elevated, theme.colors.surface.primary]}
              style={StyleSheet.absoluteFill}
            />
            {isHttpUrl(banner) && <Image source={{ uri: banner }} style={styles.bannerImg} resizeMode="cover" />}
          </View>
          <View style={styles.avatarWrap}>
            <ProfileAvatar uri={isHttpUrl(picture) ? picture : null} name={name} size={AVATAR} />
          </View>
        </View>

        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={2}>{name || 'No name yet'}</Text>
          {!!username && username !== name && <Text style={styles.username} numberOfLines={1}>@{username}</Text>}
          {!!nip05 && <Badge label={nip05} icon="at-outline" tone="primary" style={styles.nip05} />}
          {!!about && <Text style={styles.about}>{about}</Text>}
        </View>

        {/* Shareable Nostr code */}
        <View>
          <SectionHeader title="Your Nostr code" eyebrow />
          <Card style={styles.qrCard}>
            <View style={styles.qrFrame}>
              <ReceiveQr value={code} size={QR} label="Nostr code" />
            </View>
            <Text style={styles.qrHint}>Friends scan this to add you as a contact.</Text>
            <Text style={styles.npub} numberOfLines={1} selectable>{shortNpub(npub)}</Text>
            <Divider style={styles.qrDivider} />
            <View style={styles.qrActions}>
              <View style={styles.qrAction}>
                <CopyButton value={npub} label="Copy" size={16} color={theme.colors.primary[500]} />
              </View>
              <View style={styles.qrActionSeparator} />
              <TouchableOpacity style={styles.qrAction} onPress={share} accessibilityRole="button" accessibilityLabel="Share">
                <Ionicons name="share-outline" size={16} color={theme.colors.primary[500]} />
                <Text style={styles.actionText}>Share</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>

        {/* Payments */}
        {!!lud16 && (
          <View>
            <SectionHeader title="Payments" eyebrow />
            <Card style={styles.listCard}>
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="flash" size={16} color={theme.colors.warning[500]} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Lightning address</Text>
                  <Text style={styles.rowValue} numberOfLines={1} selectable>{lud16}</Text>
                </View>
                <CopyButton value={lud16} size={16} />
              </View>
            </Card>
          </View>
        )}

        {/* Nostr settings: the only settings entry on this screen */}
        <View>
          <SectionHeader title="Nostr" eyebrow />
          <Card style={styles.listCard}>
            <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('NostrSettings')}
              accessibilityRole="button" accessibilityLabel="Nostr settings"
              accessibilityHint="Manage relays, keys and your Nostr identity">
              <View style={styles.rowIcon}>
                <Ionicons name="radio-outline" size={16} color={theme.colors.primary[500]} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowValue}>Nostr settings</Text>
                <Text style={styles.rowLabel} numberOfLines={1}>Relays, keys and identity</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const AVATAR = 88;
const RING = 4;
const QR = 184;
const MIN_TOUCH = 44;

const makeStyles = (theme: ReturnType<typeof useAppTheme>) => {
  const fs = theme.typography.fontSize;
  const lh = theme.typography.lineHeight;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background.secondary },
    content: { padding: theme.spacing[4], paddingBottom: theme.spacing[12], gap: theme.spacing[6] },
    editAction: {
      minHeight: MIN_TOUCH,
      paddingHorizontal: theme.spacing[3],
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing[1.5],
    },
    editText: {
      color: theme.colors.primary[500],
      fontSize: fs.sm,
      fontWeight: theme.typography.fontWeight.semibold,
    },

    hero: { alignItems: 'center', marginBottom: -theme.spacing[4] },
    banner: {
      alignSelf: 'stretch',
      height: theme.spacing[28],
      borderRadius: theme.borderRadius['2xl'],
      overflow: 'hidden',
      backgroundColor: theme.colors.surface.primary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.light,
    },
    bannerImg: { width: '100%', height: '100%' },
    avatarWrap: {
      marginTop: -AVATAR / 2,
      borderRadius: AVATAR / 2 + RING,
      borderWidth: RING,
      borderColor: theme.colors.background.secondary,
      backgroundColor: theme.colors.background.secondary,
    },

    identity: { alignItems: 'center', gap: theme.spacing[1], paddingHorizontal: theme.spacing[2] },
    name: {
      fontSize: fs['2xl'],
      lineHeight: leading(fs['2xl'], lh.tight),
      fontWeight: theme.typography.fontWeight.bold,
      letterSpacing: theme.typography.letterSpacing.tight,
      color: theme.colors.text.primary,
      textAlign: 'center',
    },
    username: {
      fontSize: fs.sm,
      lineHeight: leading(fs.sm, lh.normal),
      color: theme.colors.text.secondary,
    },
    nip05: { marginTop: theme.spacing[1] },
    about: {
      marginTop: theme.spacing[3],
      fontSize: fs.sm,
      lineHeight: leading(fs.sm, lh.relaxed),
      color: theme.colors.text.primary,
      textAlign: 'center',
    },

    listCard: { padding: 0, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing[3],
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[3],
      minHeight: theme.spacing[16],
    },
    rowIcon: {
      width: theme.spacing[9],
      height: theme.spacing[9],
      borderRadius: theme.borderRadius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface.elevated,
    },
    rowText: { flex: 1, minWidth: 0, gap: theme.spacing[0.5] },
    rowLabel: {
      fontSize: fs.xs,
      lineHeight: leading(fs.xs, lh.normal),
      color: theme.colors.text.tertiary,
    },
    rowValue: {
      fontSize: fs.sm,
      lineHeight: leading(fs.sm, lh.normal),
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeight.medium,
    },

    qrCard: { alignItems: 'center', paddingBottom: 0 },
    qrFrame: {
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.xl,
      backgroundColor: theme.colors.surface.secondary,
    },
    qrHint: {
      marginTop: theme.spacing[4],
      fontSize: fs.sm,
      lineHeight: leading(fs.sm, lh.normal),
      color: theme.colors.text.secondary,
      textAlign: 'center',
    },
    npub: {
      marginTop: theme.spacing[1],
      fontSize: fs.xs,
      lineHeight: leading(fs.xs, lh.normal),
      fontFamily: theme.typography.fontFamily.mono,
      color: theme.colors.text.tertiary,
    },
    qrDivider: { alignSelf: 'stretch', marginTop: theme.spacing[4] },
    qrActions: { flexDirection: 'row', alignSelf: 'stretch', alignItems: 'center' },
    qrAction: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing[1.5],
      minHeight: theme.spacing[12],
    },
    qrActionSeparator: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      marginVertical: theme.spacing[2],
      backgroundColor: theme.colors.border.light,
    },
    actionText: {
      fontSize: fs.sm,
      fontWeight: theme.typography.fontWeight.semibold,
      color: theme.colors.primary[500],
    },
  });
};
