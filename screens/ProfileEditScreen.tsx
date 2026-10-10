import { useAppTheme } from '../theme/ThemeProvider';
// screens/ProfileEditScreen.tsx
//
// The one editor for the user's Nostr profile, opened from the Profile page
// and from Nostr settings. Saving publishes kind-0 metadata: only the
// fields changed here are applied, on top of the latest profile on the relays.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
  Linking,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { motion, theme } from '../theme';
import { Button, Callout, EmptyState, Input } from '../components';
import { ScreenHeader } from '../components/ScreenHeader';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { PhotoChoiceSheet } from '../components/PhotoChoiceSheet';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  loadNostrProfile,
  restoreNostrConnection,
  updateNostrProfile,
} from '../store/slices/nostrSlice';
import { getStoredHandle } from '../services/kaleidoswapMe';
import ToastService from '../services/ToastService';
import NostrService from '../services/NostrService';
import { BLOSSOM_SERVER, base64ToBytes, serverHost, sniffImageType, uploadToBlossom } from '../utils/blossom';
import {
  PROFILE_FORM_FIELDS,
  suggestProfile,
  isHttpUrl,
  profileToForm,
  validateProfileForm,
  type ProfileForm,
  type ProfileFormErrors,
  type ProfileFormField,
} from '../utils/nostrProfile';

interface Props {
  navigation: any;
}

type PhotoField = 'picture' | 'banner';

export default function ProfileEditScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const styles = makeStyles(theme);
  const dispatch = useAppDispatch();
  const profile = useAppSelector(s => s.nostr?.profile ?? null);
  const publicKey = useAppSelector(s => s.nostr?.publicKey ?? null);
  const isConnected = useAppSelector(s => !!s.nostr?.isConnected);
  const walletId = useAppSelector(s => s.wallet?.activeWallet?.id);

  // `initial` is what the form started from; only fields that differ from it
  // are published, so a stale local copy never overwrites newer relay data.
  const [initial, setInitial] = useState<ProfileForm>(() => profileToForm(profile));
  const [form, setForm] = useState<ProfileForm>(initial);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [uploading, setUploading] = useState<PhotoField | null>(null);
  const [choosing, setChoosing] = useState<PhotoField | null>(null);
  const touched = useRef(false);

  const changed = useMemo(
    () => PROFILE_FORM_FIELDS.filter(f => form[f].trim() !== initial[f].trim()),
    [form, initial],
  );

  // Pull the latest profile once; adopt it unless the user has started typing.
  useEffect(() => {
    if (isConnected) dispatch(loadNostrProfile());
  }, [dispatch, isConnected]);
  useEffect(() => {
    if (touched.current) return;
    const next = profileToForm(profile);
    setInitial(next);
    setForm(next);
  }, [profile]);

  useEffect(() => {
    if (!walletId) return;
    let live = true;
    getStoredHandle(walletId)
      .then(h => { if (live) setWalletAddress(h?.lightningAddress ?? null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [walletId]);

  const set = (field: ProfileFormField) => (text: string) => {
    touched.current = true;
    setForm(prev => ({ ...prev, [field]: text }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  // Pick a photo, upload it to a public media server and use the returned link.
  const choosePhoto = async (field: PhotoField) => {
    if (uploading || saving) return;
    const toast = ToastService.getInstance();
    let asset: ImagePicker.ImagePickerAsset | undefined;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        // iOS can only crop to a square, so the banner is used uncropped there.
        allowsEditing: field === 'picture' || Platform.OS === 'android',
        aspect: field === 'picture' ? [1, 1] : [3, 1],
        quality: 0.7,
        base64: true,
      });
      if (picked.canceled) return;
      asset = picked.assets?.[0];
    } catch {
      toast.error("Couldn't open your photos");
      return;
    }
    if (!asset?.base64) {
      toast.error("Couldn't read that photo");
      return;
    }

    setUploading(field);
    try {
      const nostr = NostrService.getInstance();
      if (!nostr.canSign()) await dispatch(restoreNostrConnection()).unwrap();
      const bytes = base64ToBytes(asset.base64);
      const url = await uploadToBlossom({
        bytes,
        mimeType: sniffImageType(bytes) ?? asset.mimeType ?? 'image/jpeg',
        name: asset.fileName || `${field}.jpg`,
        sign: template => nostr.signEvent(template),
      });
      set(field)(url);
      toast.success('Photo uploaded. Save to update your profile.');
    } catch (e: any) {
      const reason = e?.message ? `: ${e.message}` : '';
      toast.error(`Couldn't upload the photo${reason}`);
    } finally {
      setUploading(null);
    }
  };

  // Close the choice first: the photo library can't open over a closing sheet.
  const pickFromLibrary = (field: PhotoField) => {
    setChoosing(null);
    setTimeout(() => { void choosePhoto(field); }, motion.duration.base + 80);
  };
  const applyChoice = (field: PhotoField, value: string) => {
    setChoosing(null);
    set(field)(value);
  };

  const save = async () => {
    const found = validateProfileForm(form);
    // Photo links only change through the choice sheet, which checks them;
    // an odd link set by another app shouldn't block saving other fields.
    for (const f of ['picture', 'banner', 'website'] as const) if (!changed.includes(f)) delete found[f];
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (changed.length === 0) {
      navigation.goBack();
      return;
    }

    setSaving(true);
    try {
      if (!isConnected) await dispatch(restoreNostrConnection()).unwrap();
      const edits: Partial<ProfileForm> = {};
      for (const f of changed) edits[f] = form[f];
      await dispatch(updateNostrProfile(edits)).unwrap();
      ToastService.getInstance().success('Profile updated on Nostr');
      navigation.goBack();
    } catch (e: any) {
      const reason = e?.message ? `: ${e.message}` : '';
      ToastService.getInstance().error(`Couldn't update your profile${reason}`);
    } finally {
      setSaving(false);
    }
  };

  if (!publicKey) {
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

  const banner = form.banner.trim();
  const picture = form.picture.trim();
  const previewName = (form.display_name || form.name).trim();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Edit profile" showBack />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.preview}>
            <TouchableOpacity style={styles.banner} onPress={() => setChoosing('banner')} disabled={!!uploading}
              accessibilityRole="button" accessibilityLabel="Change banner">
              {isHttpUrl(banner) && <Image source={{ uri: banner }} style={styles.bannerImg} resizeMode="cover" />}
              {uploading === 'banner' ? (
                <View style={styles.busy}><ActivityIndicator color={theme.colors.primary[500]} /></View>
              ) : (
                <View style={[styles.badge, styles.bannerBadge]}>
                  <Ionicons name="camera" size={14} color={theme.colors.background.secondary} />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.avatarWrap} onPress={() => setChoosing('picture')} disabled={!!uploading}
              accessibilityRole="button" accessibilityLabel="Change profile photo">
              <ProfileAvatar uri={isHttpUrl(picture) ? picture : null} name={previewName} size={AVATAR} />
              {uploading === 'picture' ? (
                <View style={[styles.busy, styles.avatarBusy]}><ActivityIndicator color={theme.colors.primary[500]} /></View>
              ) : (
                <View style={[styles.badge, styles.avatarBadge]}>
                  <Ionicons name="camera" size={14} color={theme.colors.background.secondary} />
                </View>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            Tap the photo or banner to change it. Photos you choose are uploaded to a public media server ({serverHost(BLOSSOM_SERVER)}).
          </Text>

          {!isConnected && (
            <Callout tone="warning" message="Nostr is offline. We'll reconnect when you save." />
          )}

          <Button title="Surprise me · name & avatar" variant="secondary" disabled={saving || !!uploading} onPress={() => {
            touched.current = true; setForm(prev => ({ ...prev, ...suggestProfile() }));
          }} />
          <View style={styles.form}>
            <Input label="Display name" placeholder="Satoshi" value={form.display_name}
              onChangeText={set('display_name')} error={errors.display_name} />
            <Input label="Username" placeholder="satoshi" value={form.name} autoCapitalize="none" autoCorrect={false}
              onChangeText={set('name')} error={errors.name} />
            <Input label="About" placeholder="A few words about you" value={form.about} multiline numberOfLines={3}
              onChangeText={set('about')} error={errors.about} />
            <View>
              <Input label="Lightning address" placeholder="you@claimzero.me" value={form.lud16}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                onChangeText={set('lud16')} error={errors.lud16} />
              {!form.lud16.trim() && <TouchableOpacity style={styles.suggestion} accessibilityRole="link" onPress={() => Linking.openURL('https://claimzero.me').catch(() => ToastService.getInstance().error("Couldn't open ClaimZero"))}>
                <Text style={styles.suggestionText}>Get a Lightning address on claimzero.me ↗</Text>
              </TouchableOpacity>}
              {!!walletAddress && walletAddress !== form.lud16.trim() && (
                <TouchableOpacity onPress={() => set('lud16')(walletAddress)} accessibilityRole="button"
                  style={styles.suggestion}>
                  <Text style={styles.suggestionText} numberOfLines={1}>Use my wallet's address · {walletAddress}</Text>
                </TouchableOpacity>
              )}
            </View>
            <Input label="Nostr address (NIP-05)" placeholder="you@claimzero.me" value={form.nip05}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              onChangeText={set('nip05')} error={errors.nip05} />
            {!!form.lud16.trim().match(/^[^@]+@claimzero\.me$/i) && form.nip05 !== form.lud16 && <TouchableOpacity accessibilityRole="button" onPress={() => set('nip05')(form.lud16.trim())}>
              <Text style={styles.suggestionText}>Use my ClaimZero address for NIP-05</Text>
            </TouchableOpacity>}
            <Text style={styles.hint}>Use NIP-05 after enabling it with your address provider.</Text>
          </View>

          <Text style={styles.hint}>Your profile is public on Nostr and updates in every Nostr app.</Text>

        </ScrollView>
        <View style={{ padding: theme.spacing[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light }}>
          <Button title={saving ? 'Saving…' : 'Save'} onPress={save} loading={saving}
            disabled={saving || !!uploading || changed.length === 0} />
        </View>
      </KeyboardAvoidingView>
      <PhotoChoiceSheet
        visible={!!choosing}
        title={choosing === 'banner' ? 'Banner' : 'Profile photo'}
        current={choosing ? form[choosing] : ''}
        uploadHost={serverHost(BLOSSOM_SERVER)}
        onChoosePhoto={() => { if (choosing) pickFromLibrary(choosing); }}
        onUseLink={url => { if (choosing) applyChoice(choosing, url); }}
        onRemove={() => { if (choosing) applyChoice(choosing, ''); }}
        onClose={() => setChoosing(null)}
      />
    </View>
  );
}

const AVATAR = 80;

const makeStyles = (theme: typeof import('../theme').theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.secondary },
  flex: { flex: 1 },
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  preview: { marginBottom: AVATAR / 2 - theme.spacing[2] },
  banner: {
    height: 64,
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  bannerImg: { width: '100%', height: '100%' },
  busy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background.backdrop,
  },
  avatarBusy: { borderRadius: AVATAR / 2 },
  badge: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary[500],
  },
  bannerBadge: { top: theme.spacing[2], right: theme.spacing[2] },
  avatarBadge: { right: -2, bottom: -2 },
  avatarWrap: {
    position: 'absolute',
    left: theme.spacing[4],
    bottom: -AVATAR / 2,
    borderRadius: AVATAR / 2 + 3,
    borderWidth: 3,
    borderColor: theme.colors.background.secondary,
  },
  form: { gap: theme.spacing[3] },
  suggestion: { marginTop: theme.spacing[2], alignSelf: 'flex-start' },
  suggestionText: { fontSize: theme.typography.fontSize.sm, color: theme.colors.primary[500], fontWeight: '600' },
  hint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
});
