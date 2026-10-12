import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ensureOnboardingIdentity } from '../services/onboardingIdentity';
import { initializeProtocolServices } from '../services/initializeServices';
import { claimHandle, getStoredHandle, checkName, nameProblem, normalizeName, KALEIDOSWAP_ME_DOMAIN } from '../services/kaleidoswapMe';
import { restoreNostrConnection, setPublicKeyData, updateNostrProfile } from '../store/slices/nostrSlice';

export default function OnboardingProfileScreen({ navigation, route }: { navigation: any; route?: { params?: { preview?: boolean } } }) {
  const preview = __DEV__ && !!route?.params?.preview;
  const t = useAppTheme();
  const dispatch = useAppDispatch();
  const wallet = useAppSelector(s => s.wallet.activeWallet);
  const profile = useAppSelector(s => s.nostr.profile);
  const [name, setName] = useState(profile?.name ?? '');
  const [identity, setIdentity] = useState<Awaited<ReturnType<typeof ensureOnboardingIdentity>> | null>(null);
  const [withAddress, setWithAddress] = useState(true);
  const [availability, setAvailability] = useState('');
  const [previewDone, setPreviewDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const username = normalizeName(name);
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const prepareIdentity = async () => {
    const result = await ensureOnboardingIdentity((wallet as any)?.encrypted_mnemonic || (wallet as any)?.mnemonic || '');
    dispatch(setPublicKeyData(result)); setIdentity(result); return result;
  };
  useEffect(() => { if (preview) { setIdentity({ publicKey: '', npub: '', fromWallet: true }); return; } let active = true; void ensureOnboardingIdentity((wallet as any)?.encrypted_mnemonic || (wallet as any)?.mnemonic || '')
    .then(result => { if (active) { dispatch(setPublicKeyData(result)); setIdentity(result); } })
    .catch(() => { if (active) setError('Could not prepare your profile. Try again.'); });
    return () => { active = false; };
  }, [wallet?.id]);
  useEffect(() => {
    setAvailability('');
    if (preview) { if (username) setAvailability('Example username'); return; }
    if (!withAddress || !username || nameProblem(username)) return;
    let active = true;
    const timer = setTimeout(() => void checkName(username).then(result => {
      if (active) setAvailability(result.available ? 'Available' : result.error || 'Name unavailable');
    }), 450);
    return () => { active = false; clearTimeout(timer); };
  }, [username, withAddress]);
  const save = async () => {
    if (preview) { setPreviewDone(true); return; }
    if (working.current || !wallet?.id || !username) return;
    if (withAddress && nameProblem(username)) { setError(nameProblem(username)!); return; }
    working.current = true; setBusy(true); setError('');
    try {
      const keys = identity ?? await prepareIdentity();
      const connection = await dispatch(restoreNostrConnection()).unwrap();
      if (!connection.success) throw new Error('Could not connect to Nostr. Try again.');
      let handle = await getStoredHandle(wallet.id);
      if (withAddress && !handle) {
        await initializeProtocolServices();
        handle = await claimHandle(wallet.id, username, { nostrPubkey: keys.publicKey });
      }
      await dispatch(updateNostrProfile({ name: handle?.name ?? username, display_name: handle?.name ?? username,
        ...(handle ? { lud16: handle.lightningAddress } : {}) })).unwrap();
      navigation.replace('Dashboard');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create your profile. Try again.'); }
    finally { working.current = false; setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[6], gap: t.spacing[5] }}>
        {preview && <Text style={{ ...text, color: t.colors.warning[500] }}>PREVIEW · No profile published</Text>}
        <View style={{ alignItems: 'center', gap: t.spacing[3], paddingTop: t.spacing[8] }}>
          <ProfileAvatar name={name} uri={profile?.picture} size={80} />
          <Text accessibilityRole="header" style={{ ...text, fontSize: t.typography.fontSize['2xl'], fontWeight: '700' }}>Your profile</Text>
          <Text style={{ ...text, color: t.colors.text.secondary, textAlign: 'center' }}>{identity?.fromWallet ? 'One recovery phrase for your wallet and Nostr.' : identity ? 'Using your existing Nostr identity and its backup.' : 'Preparing your identity…'}</Text>
        </View>
        <Input label="Username" accessibilityLabel="Username" value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} placeholder="yourname" maxLength={32} editable={!busy} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] }}>
          <View style={{ flex: 1 }}><Text style={text}>Get a Lightning address</Text><Text style={{ ...text, color: t.colors.text.secondary }}>{username || 'yourname'}@{KALEIDOSWAP_ME_DOMAIN}</Text></View>
          <Switch accessibilityLabel="Get a Lightning address" value={withAddress} disabled={busy} onValueChange={setWithAddress} />
        </View>
        {!!availability && <Text accessibilityLiveRegion="polite" style={{ ...text, color: t.colors.text.secondary }}>{availability}</Text>}
        {previewDone && <Text style={text}>Profile preview ready · No name claimed</Text>}
        {!!error && <Text accessibilityLiveRegion="polite" style={{ ...text, color: t.colors.warning[500] }}>{error}</Text>}
        <Text style={{ ...text, color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>Your profile is public on Nostr.</Text>
        <Button title={busy ? 'Creating profile…' : 'Create profile'} onPress={save} loading={busy} disabled={busy || !username} />
        <Button title="Not now" variant="ghost" disabled={busy} onPress={() => navigation.replace('Dashboard')} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
