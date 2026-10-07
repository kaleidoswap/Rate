// screens/ProfileEditScreen.tsx
//
// The one editor for the user's Nostr profile, opened from the Dashboard
// header and from Nostr settings. Saving publishes kind-0 metadata: only the
// fields changed here are applied, on top of the latest profile on the relays.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '../theme';
import { Button, Callout, EmptyState, Input } from '../components';
import { ScreenHeader } from '../components/ScreenHeader';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  loadNostrProfile,
  restoreNostrConnection,
  updateNostrProfile,
} from '../store/slices/nostrSlice';
import { getStoredHandle } from '../services/kaleidoswapMe';
import ToastService from '../services/ToastService';
import {
  PROFILE_FORM_FIELDS,
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

export default function ProfileEditScreen({ navigation }: Props) {
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

  const save = async () => {
    const found = validateProfileForm(form);
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
            <View style={styles.banner}>
              {isHttpUrl(banner) && <Image source={{ uri: banner }} style={styles.bannerImg} resizeMode="cover" />}
            </View>
            <View style={styles.avatarWrap}>
              <ProfileAvatar uri={isHttpUrl(picture) ? picture : null} name={previewName} size={80} />
            </View>
          </View>

          {!isConnected && (
            <Callout tone="warning" message="Nostr is offline. We'll reconnect when you save." />
          )}

          <View style={styles.form}>
            <Input label="Display name" placeholder="Satoshi" value={form.display_name}
              onChangeText={set('display_name')} error={errors.display_name} />
            <Input label="Username" placeholder="satoshi" value={form.name} autoCapitalize="none" autoCorrect={false}
              onChangeText={set('name')} error={errors.name} />
            <Input label="About" placeholder="A few words about you" value={form.about} multiline numberOfLines={3}
              onChangeText={set('about')} error={errors.about} />
            <Input label="Picture URL" placeholder="https://…" value={form.picture} autoCapitalize="none"
              autoCorrect={false} keyboardType="url" onChangeText={set('picture')} error={errors.picture} />
            <Input label="Banner URL" placeholder="https://…" value={form.banner} autoCapitalize="none"
              autoCorrect={false} keyboardType="url" onChangeText={set('banner')} error={errors.banner} />
            <View>
              <Input label="Lightning address" placeholder="you@kaleidoswap.me" value={form.lud16}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                onChangeText={set('lud16')} error={errors.lud16} />
              {!!walletAddress && walletAddress !== form.lud16.trim() && (
                <TouchableOpacity onPress={() => set('lud16')(walletAddress)} accessibilityRole="button"
                  style={styles.suggestion}>
                  <Text style={styles.suggestionText} numberOfLines={1}>Use my wallet's address · {walletAddress}</Text>
                </TouchableOpacity>
              )}
            </View>
            <Input label="Nostr address (NIP-05)" placeholder="you@example.com" value={form.nip05}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              onChangeText={set('nip05')} error={errors.nip05} />
            <Input label="Website" placeholder="https://" value={form.website} autoCapitalize="none"
              autoCorrect={false} keyboardType="url" onChangeText={set('website')} error={errors.website} />
          </View>

          <Text style={styles.hint}>Your profile is public on Nostr and updates in every Nostr app.</Text>
          <Button title={saving ? 'Saving…' : 'Save'} onPress={save} loading={saving}
            disabled={saving || changed.length === 0} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const AVATAR = 80;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.secondary },
  flex: { flex: 1 },
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  preview: { marginBottom: AVATAR / 2 - theme.spacing[2] },
  banner: {
    height: 110,
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
  form: { gap: theme.spacing[3] },
  suggestion: { marginTop: theme.spacing[2], alignSelf: 'flex-start' },
  suggestionText: { fontSize: theme.typography.fontSize.sm, color: theme.colors.primary[500], fontWeight: '600' },
  hint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
});
