// components/NostrProfileManager.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Clipboard,
  Share,
  Image,
  ScrollView,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { RootState } from '../store';
import {
  initializeNostr,
  loadNostrProfile,
  updateNostrProfile,
  setKeys,
  clearKeys,
  setConnected,
  setError,
  saveKeysSecurely,
  clearKeysSecurely,
  setNWCConnectionString,
} from '../store/slices/nostrSlice';
import NostrService from '../services/NostrService';
import SecurityService from '../services/SecurityService';
import { theme, leading } from '../theme';
import { Button } from './Button';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { CopyButton } from './CopyButton';
import { WALLET_SERVICE_NWC_URI_KEY } from '../services/nwc/connectionStore';
import ToastService from '../services/ToastService';
import { copySensitive } from '../utils/sensitiveClipboard';

const toast = () => ToastService.getInstance();

interface Props {
  navigation?: any;
}

export default function NostrProfileManager({ navigation }: Props) {
  const dispatch = useDispatch();
  const nostrState = useSelector((state: RootState) => state.nostr);
  const [showKeyImport, setShowKeyImport] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    display_name: '',
    about: '',
    website: '',
    lud16: '', // Lightning address
  });
  const [relayInput, setRelayInput] = useState('');
  const [isAddingRelay, setIsAddingRelay] = useState(false);
  const [isRemovingRelay, setIsRemovingRelay] = useState(false);
  const [relayStatus, setRelayStatus] = useState<{ url: string; connected: boolean }[]>([]);

  const {
    isConnected,
    isInitializing,
    profile,
    isProfileLoading,
    publicKey,
    npub,
    nsec,
    error,
    walletConnectEnabled,
    nwcConnectionString,
    relays,
    connectedWallet,
    nwcWalletType,
  } = nostrState;

  useEffect(() => {
    if (profile) {
      setProfileForm({
        name: profile.name || '',
        display_name: profile.display_name || '',
        about: profile.about || '',
        website: profile.website || '',
        lud16: profile.lud16 || '',
      });
    }
  }, [profile]);

  // NostrService exposes no relay connect/disconnect event, so poll the pool
  // while connected; a one-shot read per render went stale between renders.
  useEffect(() => {
    if (!isConnected) {
      setRelayStatus([]);
      return;
    }
    const read = () => setRelayStatus(NostrService.getInstance().getRelayStatus());
    read();
    const id = setInterval(read, 3000);
    return () => clearInterval(id);
  }, [isConnected, relays]);

  useEffect(() => {
    if (!walletConnectEnabled || nwcConnectionString) return;
    SecureStore.getItemAsync(WALLET_SERVICE_NWC_URI_KEY)
      .then((uri) => {
        if (uri) dispatch(setNWCConnectionString(uri));
      })
      .catch(() => undefined);
  }, [dispatch, walletConnectEnabled, nwcConnectionString]);

  const handleGenerateKeys = async () => {
    Alert.alert(
      'Generate New Keys',
      'This will create a new Nostr identity and save it securely on your device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            try {
              const nostrService = NostrService.getInstance();
              const keys = nostrService.generateKeyPair();

              // Save keys securely first
              await dispatch(saveKeysSecurely({
                privateKey: keys.privateKey,
                nsec: keys.nsec
              }) as any);

              // Set keys in state (private key will be cleared from persisted store)
              dispatch(setKeys(keys));

              // Initialize with new keys
              const settings = {
                privateKey: keys.privateKey,
                relays: nostrState.relays,
              };

              await dispatch(initializeNostr(settings) as any);

              Alert.alert(
                'Keys Generated',
                'New Nostr keys have been generated and saved securely! Your account will be restored automatically next time you open the app.',
                [
                  { text: 'OK' },
                  {
                    text: 'Backup Keys',
                    onPress: () => handleBackupKeys(keys.nsec)
                  }
                ]
              );
            } catch (error) {
              toast().error('Failed to generate keys');
            }
          }
        }
      ]
    );
  };

  const handleImportKeys = async () => {
    if (!keyInput.trim()) {
      toast().error('Please enter your private key (nsec, npriv, or hex)');
      return;
    }

    setIsImporting(true);
    try {
      const nostrService = NostrService.getInstance();
      const keys = nostrService.importPrivateKey(keyInput.trim());

      if (!keys) {
        toast().error('Invalid private key format. Use nsec1…, npriv1…, or 64-character hex.');
        return;
      }

      // Save keys securely first
      await dispatch(saveKeysSecurely({
        privateKey: keys.privateKey,
        nsec: keys.nsec
      }) as any);

      // Set keys in state
      dispatch(setKeys(keys));

      // Initialize with imported keys
      const settings = {
        privateKey: keys.privateKey,
        relays: nostrState.relays,
      };

      await dispatch(initializeNostr(settings) as any);

      setShowKeyImport(false);
      setKeyInput('');

      toast().success('Keys imported and saved securely');

      // Load profile
      await dispatch(loadNostrProfile() as any);
    } catch (error) {
      toast().error('Failed to import keys');
    } finally {
      setIsImporting(false);
    }
  };

  // The nsec is the whole identity: gate it behind the device owner (biometrics
  // or passcode, as for the recovery phrase) and only ever copy it to the
  // auto-clearing clipboard — no share sheet, which can hand it to any app.
  const handleBackupKeys = async (nsecKey?: string) => {
    const keyToBackup = nsecKey || nsec;
    if (!keyToBackup) {
      toast().error('No private key to back up');
      return;
    }
    const security = SecurityService.getInstance();
    if (!(await security.isDeviceAuthAvailable())) {
      toast().error('Set a device passcode or biometric lock before backing up your key.');
      return;
    }
    if (!(await security.authenticateForReveal('Authenticate to copy your Nostr private key'))) return;
    copySensitive(keyToBackup);
    toast().success('Private key copied. The clipboard clears in a minute — store it safely now.', 5000);
  };

  const handleUpdateProfile = async () => {
    if (!isConnected) {
      toast().error('Not connected to Nostr');
      return;
    }

    try {
      await dispatch(updateNostrProfile(profileForm) as any);
      setShowProfileEdit(false);
      toast().success('Profile updated');
    } catch (error) {
      toast().error('Failed to update profile');
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect from Nostr',
      'Do you want to disconnect temporarily or remove your stored keys?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect Only',
          onPress: async () => {
            try {
              const nostrService = NostrService.getInstance();
              await nostrService.disconnect();
              dispatch(setConnected(false));
              toast().info('Disconnected from Nostr. Your keys stay stored for next time.');
            } catch (error) {
              console.error('Failed to disconnect:', error);
            }
          }
        },
        {
          text: 'Remove Keys',
          style: 'destructive',
          onPress: async () => {
            try {
              const nostrService = NostrService.getInstance();
              await nostrService.disconnect();

              // Clear from secure storage
              await dispatch(clearKeysSecurely() as any);

              // Clear from state
              dispatch(clearKeys());
              dispatch(setConnected(false));

              toast().success('Disconnected and stored keys removed');
            } catch (error) {
              console.error('Failed to disconnect:', error);
            }
          }
        }
      ]
    );
  };

  const handleAddRelay = async () => {
    if (!relayInput.trim()) {
      toast().error('Please enter a relay URL');
      return;
    }

    setIsAddingRelay(true);
    try {
      const nostrService = NostrService.getInstance();
      const success = await nostrService.addRelay(relayInput.trim());

      if (success) {
        setRelayInput('');
        // Refresh relays in Redux state
        const settings = {
          privateKey: nostrState.privateKey!,
          relays: await nostrService.getRelays()
        };
        await dispatch(initializeNostr(settings) as any);
        toast().success('Relay added');
      } else {
        toast().error('Failed to add relay');
      }
    } catch (error) {
      toast().error('Failed to add relay');
    } finally {
      setIsAddingRelay(false);
    }
  };

  const handleRemoveRelay = async (url: string) => {
    Alert.alert(
      'Remove Relay',
      `Are you sure you want to remove ${url}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsRemovingRelay(true);
            try {
              const nostrService = NostrService.getInstance();
              const success = await nostrService.removeRelay(url);

              if (success) {
                // Refresh relays in Redux state
                const settings = {
                  privateKey: nostrState.privateKey!,
                  relays: await nostrService.getRelays()
                };
                await dispatch(initializeNostr(settings) as any);
                toast().success('Relay removed');
              } else {
                toast().error('Failed to remove relay');
              }
            } catch (error) {
              toast().error('Failed to remove relay');
            } finally {
              setIsRemovingRelay(false);
            }
          }
        }
      ]
    );
  };

  const relayUp = (url: string) => relayStatus.find(r => r.url === url)?.connected ?? false;
  const relaysUp = relays.filter(relayUp).length;
  const shortNpub = npub ? `${npub.slice(0, 14)}…${npub.slice(-8)}` : '';
  const name = profile?.display_name || profile?.name || 'Your profile';
  const walletLabel = connectedWallet ? (nwcWalletType === 'rln' ? 'RGB Lightning node' : 'Lightning wallet') : null;

  const reconnect = async () => {
    await dispatch(initializeNostr({ privateKey: nostrState.privateKey!, relays }) as any);
  };

  const Row = ({ icon, tint, label, detail, onPress, danger, last, right }: {
    icon: keyof typeof Ionicons.glyphMap; tint?: string; label: string; detail?: string;
    onPress?: () => void; danger?: boolean; last?: boolean; right?: React.ReactNode;
  }) => {
    const color = danger ? theme.colors.error[500] : tint ?? theme.colors.text.secondary;
    return (
      <TouchableOpacity style={[styles.row, !last && styles.rowDivider]} onPress={onPress} disabled={!onPress}
        activeOpacity={0.7} accessibilityRole={onPress ? 'button' : undefined}>
        <View style={[styles.rowIcon, { backgroundColor: `${color}1F` }]}>
          <Ionicons name={icon} size={17} color={color} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.rowLabel, danger && { color }]}>{label}</Text>
          {!!detail && <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text>}
        </View>
        {right ?? (onPress && !danger ? <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} /> : null)}
      </TouchableOpacity>
    );
  };

  // ── No identity yet: one clear choice ──────────────────────────────────────
  const renderOnboarding = () => (
    <View style={[styles.card, styles.hero]}>
      <View style={styles.heroIcon}>
        <Ionicons name="planet" size={30} color={theme.colors.primary[500]} />
      </View>
      <Text style={styles.heroTitle}>Join Nostr</Text>
      <Text style={styles.heroText}>
        Follow friends, message them and receive zaps. Your keys stay on this device.
      </Text>
      <Button title="Create my identity" onPress={handleGenerateKeys} loading={isInitializing} style={styles.heroBtn} />
      <Button title="I already have a key" variant="ghost" onPress={() => setShowKeyImport(true)} style={styles.heroBtn} />
    </View>
  );

  // ── Identity card: who you are on Nostr, at a glance ───────────────────────
  const renderIdentity = () => (
    <View style={[styles.card, styles.identity]}>
      <View style={styles.identityTop}>
        <View style={styles.avatar}>
          {profile?.picture ? (
            <Image source={{ uri: profile.picture }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitial}>{(profile?.display_name || profile?.name || 'N').charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {!!profile?.name && profile.name !== profile.display_name && (
            <Text style={styles.handle} numberOfLines={1}>@{profile.name}</Text>
          )}
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: isConnected ? theme.colors.success[500] : theme.colors.warning[500] }]} />
            <Text style={styles.statusText}>
              {isConnected ? `Online · ${relaysUp}/${relays.length} relays` : 'Offline'}
            </Text>
          </View>
        </View>
      </View>

      {!!profile?.about && <Text style={styles.about} numberOfLines={3}>{profile.about}</Text>}

      <View style={styles.keyRow}>
        <Ionicons name="key-outline" size={14} color={theme.colors.text.tertiary} />
        <Text style={styles.keyText} numberOfLines={1}>{shortNpub}</Text>
        {!!npub && <CopyButton value={npub} size={16} color={theme.colors.primary[500]} />}
      </View>
      {!!profile?.lud16 && (
        <View style={[styles.keyRow, styles.keyRowTight]}>
          <Ionicons name="flash" size={14} color={theme.colors.warning[500]} />
          <Text style={styles.keyText} numberOfLines={1}>{profile.lud16}</Text>
        </View>
      )}

      {isConnected ? (
        <View style={styles.identityActions}>
          <Button title="Edit profile" variant="secondary" size="sm" onPress={() => setShowProfileEdit(true)} style={styles.flex} />
          <Button title="Share" variant="secondary" size="sm" style={styles.flex}
            onPress={() => { if (npub) Share.share({ message: `Follow me on Nostr: ${npub}`, title: 'My Nostr profile' }); }} />
        </View>
      ) : (
        <Button title="Reconnect" onPress={reconnect} loading={isInitializing} size="sm" style={styles.reconnectBtn} />
      )}
    </View>
  );

  const renderRelays = () => (
    <>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>Relays</Text>
        <Text style={styles.sectionMeta}>{relaysUp}/{relays.length} connected</Text>
      </View>
      <View style={styles.card}>
        {relays.map((relay: string) => {
          const up = relayUp(relay);
          return (
            <View key={relay} style={[styles.relayRow, styles.rowDivider]}>
              <View style={[styles.relayDot, { backgroundColor: up ? theme.colors.success[500] : theme.colors.text.tertiary }]} />
              <Text style={[styles.relayText, !up && styles.relayDown]} numberOfLines={1}>
                {relay.replace(/^wss?:\/\//, '')}
              </Text>
              <TouchableOpacity onPress={() => handleRemoveRelay(relay)} disabled={isRemovingRelay}
                accessibilityLabel={`Remove ${relay}`} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="remove-circle-outline" size={18} color={theme.colors.text.tertiary} />
              </TouchableOpacity>
            </View>
          );
        })}
        <View style={styles.relayAdd}>
          <Input
            placeholder="wss://relay.example.com"
            value={relayInput}
            onChangeText={setRelayInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            size="sm"
            style={styles.flex}
          />
          <Button title="Add" size="sm" onPress={handleAddRelay} loading={isAddingRelay}
            disabled={isAddingRelay || !relayInput.trim()} />
        </View>
      </View>
    </>
  );

  return (
    <View>
      {!!error && (
        <TouchableOpacity style={styles.error} onPress={() => dispatch(setError(null))} accessibilityLabel="Dismiss error">
          <Ionicons name="alert-circle" size={16} color={theme.colors.error[500]} />
          <Text style={styles.errorText}>{error}</Text>
          <Ionicons name="close" size={16} color={theme.colors.text.tertiary} />
        </TouchableOpacity>
      )}

      {publicKey ? renderIdentity() : renderOnboarding()}

      {isConnected && renderRelays()}

      <Text style={styles.sectionLabel}>Wallet</Text>
      <View style={styles.card}>
        <Row icon="flash" tint={theme.colors.warning[500]} label="Connect a Lightning wallet"
          detail={walletLabel ? `Connected · ${walletLabel}` : 'Pay and check balances via NWC'}
          onPress={() => navigation?.navigate('NWCConnect')} last />
      </View>

      {!!publicKey && (
        <>
          <Text style={styles.sectionLabel}>Keys</Text>
          <View style={styles.card}>
            <Row icon="shield-checkmark-outline" tint={theme.colors.primary[500]} label="Back up private key"
              detail="Copy your nsec to restore elsewhere" onPress={() => handleBackupKeys()} />
            <Row icon="log-out-outline" label="Disconnect" danger onPress={handleDisconnect} last />
          </View>
        </>
      )}

      <Sheet visible={showKeyImport} onClose={() => { if (!isImporting) setShowKeyImport(false); }}
        title="Use an existing key" subtitle="Paste your nsec, npriv or hex private key"
        footer={<Button title={isImporting ? 'Importing…' : 'Import key'} onPress={handleImportKeys} loading={isImporting}
          disabled={isImporting || !keyInput.trim()} style={styles.sheetBtn} />}>
        <View style={styles.form}>
        <Input
          label="Private key"
          placeholder="nsec1…"
          value={keyInput}
          onChangeText={setKeyInput}
          secureTextEntry={!showKeyInput}
          autoCapitalize="none"
          autoCorrect={false}
          rightIcon={
            <View style={styles.inputIcons}>
              <TouchableOpacity accessibilityLabel="Paste" hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                onPress={async () => { try { const t = await Clipboard.getString(); if (t) setKeyInput(t.trim()); } catch { /* nothing to paste */ } }}>
                <Ionicons name="clipboard-outline" size={19} color={theme.colors.primary[500]} />
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel={showKeyInput ? 'Hide key' : 'Show key'} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                onPress={() => setShowKeyInput(!showKeyInput)}>
                <Ionicons name={showKeyInput ? 'eye-off-outline' : 'eye-outline'} size={19} color={theme.colors.text.secondary} />
              </TouchableOpacity>
            </View>
          }
        />
        <Text style={styles.hint}>Your key is stored in this device's secure storage and never leaves it.</Text>
        </View>
      </Sheet>

      <Sheet visible={showProfileEdit} onClose={() => setShowProfileEdit(false)} title="Edit profile"
        footer={<Button title={isProfileLoading ? 'Saving…' : 'Save'} onPress={handleUpdateProfile} loading={isProfileLoading}
          disabled={isProfileLoading} style={styles.sheetBtn} />}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.form}>
        <Input label="Display name" placeholder="Satoshi" value={profileForm.display_name}
          onChangeText={(text) => setProfileForm(prev => ({ ...prev, display_name: text }))} />
        <Input label="Username" placeholder="satoshi" value={profileForm.name} autoCapitalize="none"
          onChangeText={(text) => setProfileForm(prev => ({ ...prev, name: text.replace(/\s/g, '') }))} />
        <Input label="About" placeholder="A few words about you" value={profileForm.about} multiline numberOfLines={3}
          onChangeText={(text) => setProfileForm(prev => ({ ...prev, about: text }))} />
        <Input label="Lightning address" placeholder="you@kaleidoswap.me" value={profileForm.lud16} autoCapitalize="none"
          keyboardType="email-address" onChangeText={(text) => setProfileForm(prev => ({ ...prev, lud16: text }))} />
        <Input label="Website" placeholder="https://" value={profileForm.website} autoCapitalize="none" keyboardType="url"
          onChangeText={(text) => setProfileForm(prev => ({ ...prev, website: text }))} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
  },
  sectionLabel: {
    fontSize: theme.typography.fontSize.xs, fontWeight: '700', color: theme.colors.text.tertiary,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: theme.spacing[5], marginBottom: theme.spacing[2], marginLeft: theme.spacing[1],
  },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionMeta: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginRight: theme.spacing[1] },
  // Onboarding
  hero: { alignItems: 'center', padding: theme.spacing[5], gap: theme.spacing[2] },
  heroIcon: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${theme.colors.primary[500]}1F`, marginBottom: theme.spacing[1],
  },
  heroTitle: { fontSize: theme.typography.fontSize.xl, fontWeight: '700', color: theme.colors.text.primary },
  heroText: {
    fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, textAlign: 'center',
    lineHeight: leading(theme.typography.fontSize.sm, 1.45), marginBottom: theme.spacing[2],
  },
  heroBtn: { alignSelf: 'stretch' },
  // Identity
  identity: { padding: theme.spacing[4] },
  identityTop: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  avatar: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${theme.colors.primary[500]}29`,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontSize: 22, fontWeight: '700', color: theme.colors.primary[500] },
  name: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.text.primary },
  handle: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary },
  about: {
    fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, marginTop: theme.spacing[3],
    lineHeight: leading(theme.typography.fontSize.sm, 1.45),
  },
  keyRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], marginTop: theme.spacing[3],
    paddingLeft: theme.spacing[3], borderRadius: theme.borderRadius.lg, minHeight: 44,
    backgroundColor: theme.colors.background.secondary,
  },
  keyRowTight: { marginTop: theme.spacing[2], paddingRight: theme.spacing[3] },
  keyText: { flex: 1, fontSize: theme.typography.fontSize.sm, color: theme.colors.text.primary, fontFamily: theme.typography.fontFamily.mono },
  identityActions: { flexDirection: 'row', gap: theme.spacing[2], marginTop: theme.spacing[4] },
  reconnectBtn: { marginTop: theme.spacing[4] },
  // Rows
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 60 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.light },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  rowDetail: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
  // Relays
  relayRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 48 },
  relayDot: { width: 8, height: 8, borderRadius: 4 },
  relayText: { flex: 1, fontSize: theme.typography.fontSize.sm, color: theme.colors.text.primary },
  relayDown: { color: theme.colors.text.tertiary },
  relayAdd: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], padding: theme.spacing[3] },
  // Misc
  error: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], marginBottom: theme.spacing[3],
    padding: theme.spacing[3], borderRadius: theme.borderRadius.lg, backgroundColor: `${theme.colors.error[500]}1A`,
  },
  errorText: { flex: 1, fontSize: theme.typography.fontSize.sm, color: theme.colors.error[500] },
  inputIcons: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  form: { gap: theme.spacing[3] },
  hint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: -theme.spacing[1] },
  sheetBtn: { marginTop: theme.spacing[3] },
});
