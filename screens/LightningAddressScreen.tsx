// screens/LightningAddressScreen.tsx
//
// Your kaleidoswap.me Lightning address: claim a name, share it, get notified
// when it's paid, or give it back. Payments to it land in Spark, even with the
// app closed. Same registry and signed messages as the Rate extension.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { Callout } from '../components/Callout';
import { CopyButton } from '../components/CopyButton';
import { NetworkIcon } from '../components/NetworkIcon';
import { ReceiveQr } from '../components/receive/ReceiveQr';
import { useAppTheme } from '../theme/ThemeProvider';
import { motion } from '../theme';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setTransactionNotifications } from '../store/slices/settingsSlice';
import { feedback } from '../utils/feedback';
import {
  KALEIDOSWAP_ME_DOMAIN, checkName, claimHandle, getStoredHandle, nameProblem, normalizeName, releaseHandle, sparkSigner,
  type Availability, type StoredHandle,
} from '../services/kaleidoswapMe';
import { syncPaymentPush } from '../services/paymentNotifications';

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'done'; result: Availability };

export default function LightningAddressScreen({ navigation }: { navigation: any }) {
  const t = useAppTheme();
  const dispatch = useAppDispatch();
  const walletId = useAppSelector(s => s.wallet?.activeWallet?.id);
  const notificationsOn = useAppSelector(s => s.settings?.transactionNotifications ?? true);
  const [handle, setHandle] = useState<StoredHandle | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pushNote, setPushNote] = useState('');

  let sparkProblem = '';
  try { sparkSigner(); } catch (e) { sparkProblem = e instanceof Error ? e.message : 'Connect your Spark account first.'; }

  useEffect(() => {
    if (!walletId) { setHandle(null); return; }
    void getStoredHandle(walletId).then(setHandle);
  }, [walletId]);

  // Live availability, after the user stops typing.
  useEffect(() => {
    const n = normalizeName(name);
    if (!n) { setCheck({ state: 'idle' }); return; }
    const local = nameProblem(n);
    if (local) { setCheck({ state: 'done', result: { available: false, valid: false, error: local } }); return; }
    setCheck({ state: 'checking' });
    let live = true;
    const timer = setTimeout(() => { void checkName(n).then(result => { if (live) setCheck({ state: 'done', result }); }); }, 450);
    return () => { live = false; clearTimeout(timer); };
  }, [name]);

  const describePush = useCallback((outcome: Awaited<ReturnType<typeof syncPaymentPush>>) => {
    setPushNote(outcome === 'no-permission' ? 'Allow notifications for KaleidoSwap in your phone settings to get them.' : '');
  }, []);

  const claim = async () => {
    if (!walletId || busy) return;
    setBusy(true); setError('');
    try {
      const claimed = await claimHandle(walletId, name);
      feedback.success();
      setHandle(claimed);
      setName('');
      if (notificationsOn) describePush(await syncPaymentPush(walletId, true).catch(() => 'unchanged' as const));
    } catch (e) {
      feedback.error();
      setError(e instanceof Error ? e.message : 'Could not claim the name. Try again.');
    } finally { setBusy(false); }
  };

  const release = () => {
    if (!walletId || !handle) return;
    Alert.alert(
      `Release ${handle.lightningAddress}?`,
      'Payments to this address will stop working and anyone can claim the name. You can claim a new name afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Release', style: 'destructive', onPress: async () => {
          setBusy(true); setError('');
          try {
            await syncPaymentPush(walletId, false).catch(() => undefined);
            await releaseHandle(walletId);
            setHandle(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not release the name. Try again.');
          } finally { setBusy(false); }
        } },
      ],
    );
  };

  const toggleNotifications = async (on: boolean) => {
    dispatch(setTransactionNotifications(on));
    if (!walletId) return;
    try { describePush(await syncPaymentPush(walletId, on)); }
    catch (e) { setPushNote(e instanceof Error ? e.message : 'Could not update notifications.'); }
  };

  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const muted = { ...text, color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  const card = { padding: t.spacing[4], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light, gap: t.spacing[3] };
  const n = normalizeName(name);
  const available = check.state === 'done' && check.result.available;

  const lightningChip = (size: number) => (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.networks.lightning + '26' }}>
      <NetworkIcon network="lightning" size={Math.round(size * 0.55)} />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="Lightning address" showBack onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: t.spacing[5], gap: t.spacing[4] }} keyboardShouldPersistTaps="handled">
        {!!error && <Callout tone="error" message={error} />}

        {handle === undefined ? <ActivityIndicator color={t.colors.primary[500]} /> : handle ? (
          <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={{ gap: t.spacing[4] }}>
            <View style={[card, { alignItems: 'center', paddingVertical: t.spacing[5] }]}>
              {lightningChip(44)}
              <Text selectable accessibilityRole="header" style={{ ...text, fontSize: t.typography.fontSize.xl, fontWeight: '700', textAlign: 'center' }}>{handle.lightningAddress}</Text>
              <Text style={{ ...muted, textAlign: 'center' }}>Anyone can pay this from any Lightning wallet. It lands in Spark, even when the app is closed.</Text>
              <ReceiveQr value={handle.lightningAddress} size={200} />
              <View style={{ flexDirection: 'row', gap: t.spacing[3], alignSelf: 'stretch' }}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: t.borderRadius.md, borderWidth: 1, borderColor: t.colors.border.light }}>
                  <CopyButton value={handle.lightningAddress} label="Copy" />
                </View>
                <Button title="Share" variant="secondary" style={{ flex: 1 }}
                  onPress={() => void Share.share({ message: `Pay me with Lightning: ${handle.lightningAddress}` })} />
              </View>
            </View>

            <View style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
              <Ionicons name="notifications-outline" size={22} color={t.colors.primary[500]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...text, fontWeight: '600' }}>Payment notifications</Text>
                <Text style={muted}>{pushNote || 'A notification when a payment lands, even with the app closed. The amount and your address pass through Apple or Google to reach your phone.'}</Text>
              </View>
              <Switch accessibilityLabel="Payment notifications" value={notificationsOn} onValueChange={v => void toggleNotifications(v)}
                trackColor={{ true: t.colors.primary[500], false: t.colors.gray[300] }} />
            </View>

            <Button title="Release this name" variant="secondary" onPress={release} loading={busy} disabled={busy || !!sparkProblem} />
            {!!sparkProblem && <Text style={muted}>{sparkProblem}</Text>}
          </Animated.View>
        ) : (
          <View style={{ gap: t.spacing[4] }}>
            <View style={{ alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[3] }}>
              {lightningChip(56)}
              <Text accessibilityRole="header" style={{ ...text, fontSize: t.typography.fontSize.xl, fontWeight: '700' }}>Get your Lightning address</Text>
              <Text style={{ ...muted, textAlign: 'center' }}>A permanent name@{KALEIDOSWAP_ME_DOMAIN} anyone can pay from any Lightning wallet. Payments land in Spark, even when the app is closed.</Text>
            </View>

            {sparkProblem ? <Callout tone="warning" message={sparkProblem} /> : <>
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: t.spacing[4], borderRadius: t.borderRadius.lg, borderWidth: 1,
                backgroundColor: t.colors.surface.primary, borderColor: available ? t.colors.primary[500] : check.state === 'done' ? t.colors.warning[500] : t.colors.border.light }}>
                <TextInput accessibilityLabel="Name" value={name} onChangeText={v => { setName(v); setError(''); }} autoCapitalize="none" autoCorrect={false} autoFocus
                  placeholder="yourname" placeholderTextColor={t.colors.text.muted} maxLength={40}
                  style={{ ...text, flex: 1, fontSize: t.typography.fontSize.lg, paddingVertical: t.spacing[3] }} />
                <Text style={{ ...muted, fontSize: t.typography.fontSize.base }}>@{KALEIDOSWAP_ME_DOMAIN}</Text>
              </View>
              <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], minHeight: 20 }}>
                {check.state === 'checking' && <><ActivityIndicator size="small" color={t.colors.text.secondary} /><Text style={muted}>Checking…</Text></>}
                {check.state === 'done' && (check.result.available
                  ? <><Ionicons name="checkmark-circle" size={16} color={t.colors.success[500]} /><Text style={{ ...muted, color: t.colors.success[500] }}>{n}@{KALEIDOSWAP_ME_DOMAIN} is available</Text></>
                  : <><Ionicons name="close-circle" size={16} color={t.colors.warning[500]} /><Text style={{ ...muted, color: t.colors.warning[500] }}>{check.result.error ?? 'That name is taken.'}</Text></>)}
              </View>
              <Button title={busy ? 'Claiming…' : available ? `Claim ${n}@${KALEIDOSWAP_ME_DOMAIN}` : 'Claim'} onPress={() => void claim()} loading={busy} disabled={!available || busy} />
              <Text style={{ ...muted, textAlign: 'center' }}>Free. One name per wallet, 5 to 32 characters. You can release it later.</Text>
            </>}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
