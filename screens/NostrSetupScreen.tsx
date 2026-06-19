// screens/NostrSetupScreen.tsx
//
// Onboarding step that lets the user attach a Nostr identity to their wallet.
// They can either derive a key deterministically from their wallet seed
// (NIP-06 — recoverable from the same backup) or import an existing nsec/npriv/hex
// key. Mirrors the browser extension's seed-derived Nostr identity.
import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    StatusBar,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../theme';
import { Button, ScreenHeader } from '../components';
import { RootState } from '../store';
import NostrService from '../services/NostrService';
import { saveKeysSecurely, setKeys, initializeNostr } from '../store/slices/nostrSlice';

interface Props {
    navigation: any;
    route: { params?: { isInitialSetup?: boolean } };
}

type Mode = 'choose' | 'import';

export default function NostrSetupScreen({ navigation, route }: Props) {
    const { isInitialSetup = true } = route.params || {};
    const dispatch = useDispatch();
    const activeWallet = useSelector((state: RootState) => state.wallet?.activeWallet);
    const relays = useSelector((state: RootState) => state.nostr.relays);

    const mnemonic = useMemo(
        () => (activeWallet as any)?.encrypted_mnemonic || (activeWallet as any)?.mnemonic || '',
        [activeWallet],
    );
    const canDerive = !!mnemonic;

    const [mode, setMode] = useState<Mode>('choose');
    const [importValue, setImportValue] = useState('');
    const [importError, setImportError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const finish = () => {
        if (isInitialSetup) navigation.replace('Dashboard');
        else navigation.goBack();
    };

    const persistAndConnect = async (keys: { privateKey: string; publicKey: string; nsec: string; npub: string }) => {
        await dispatch(saveKeysSecurely({ privateKey: keys.privateKey, nsec: keys.nsec }) as any);
        dispatch(setKeys(keys));
        // Fire-and-forget relay connection; never block onboarding on the network.
        dispatch(initializeNostr({ privateKey: keys.privateKey, relays } as any) as any);
    };

    const handleDeriveFromSeed = async () => {
        setBusy(true);
        try {
            const keys = NostrService.getInstance().deriveKeysFromMnemonic(mnemonic);
            if (!keys) throw new Error('Could not derive a key from your seed.');
            await persistAndConnect(keys);
            finish();
        } catch (e: any) {
            setImportError(e?.message || 'Failed to derive key.');
        } finally {
            setBusy(false);
        }
    };

    const handleImport = async () => {
        setImportError(null);
        const trimmed = importValue.trim();
        if (!trimmed) {
            setImportError('Enter your nsec, npriv, or hex private key.');
            return;
        }
        setBusy(true);
        try {
            const keys = NostrService.getInstance().importPrivateKey(trimmed);
            if (!keys) throw new Error('Invalid key. Use an nsec1…, npriv1…, or 64-char hex key.');
            await persistAndConnect(keys);
            finish();
        } catch (e: any) {
            setImportError(e?.message || 'Failed to import key.');
        } finally {
            setBusy(false);
        }
    };

    const renderChoose = () => (
        <View style={styles.body}>
            <View style={styles.hero}>
                <View style={styles.heroIcon}>
                    <Ionicons name="planet" size={36} color={theme.colors.primary[500]} />
                </View>
                <Text style={styles.title}>Add a Nostr identity</Text>
                <Text style={styles.subtitle}>
                    Nostr powers your social contacts and wallet-connect. Choose how to set up your key —
                    you can always change this later in Settings.
                </Text>
            </View>

            <View style={styles.optionList}>
                <TouchableOpacity
                    style={[styles.optionCard, !canDerive && styles.optionCardDisabled]}
                    onPress={handleDeriveFromSeed}
                    disabled={!canDerive || busy}
                    activeOpacity={0.8}
                >
                    <View style={styles.optionIcon}>
                        <Ionicons name="key" size={24} color={theme.colors.primary[500]} />
                    </View>
                    <View style={styles.optionText}>
                        <View style={styles.optionTitleRow}>
                            <Text style={styles.optionTitle}>Generate from seed</Text>
                            <View style={styles.recommendedBadge}>
                                <Text style={styles.recommendedText}>Recommended</Text>
                            </View>
                        </View>
                        <Text style={styles.optionDesc}>
                            {canDerive
                                ? 'Derived from your wallet seed (NIP-06). Backed up by the same recovery phrase.'
                                : 'Unavailable — no wallet seed found on this device.'}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.optionCard}
                    onPress={() => { setImportError(null); setMode('import'); }}
                    disabled={busy}
                    activeOpacity={0.8}
                >
                    <View style={styles.optionIcon}>
                        <Ionicons name="download-outline" size={24} color={theme.colors.accent[500]} />
                    </View>
                    <View style={styles.optionText}>
                        <Text style={styles.optionTitle}>Import existing key</Text>
                        <Text style={styles.optionDesc}>
                            Paste an existing nsec1…, npriv1…, or hex private key from another Nostr client.
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
                </TouchableOpacity>
            </View>

            {importError && <Text style={styles.errorText}>{importError}</Text>}
            {busy && <ActivityIndicator color={theme.colors.primary[500]} style={{ marginTop: theme.spacing[4] }} />}

            <View style={styles.footer}>
                <TouchableOpacity style={styles.skipLink} onPress={finish} disabled={busy}>
                    <Text style={styles.skipLinkText}>Skip for now</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    const renderImport = () => (
        <View style={styles.body}>
            <View style={styles.hero}>
                <View style={styles.heroIcon}>
                    <Ionicons name="download-outline" size={36} color={theme.colors.accent[500]} />
                </View>
                <Text style={styles.title}>Import Nostr key</Text>
                <Text style={styles.subtitle}>
                    Paste your private key. It is stored securely on this device and never leaves it.
                </Text>
            </View>

            <Text style={styles.inputLabel}>Private key</Text>
            <TextInput
                style={styles.input}
                value={importValue}
                onChangeText={(t) => { setImportValue(t); setImportError(null); }}
                placeholder="nsec1…, npriv1…, or 64-character hex"
                placeholderTextColor={theme.colors.text.tertiary}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                editable={!busy}
            />
            {importError && <Text style={styles.errorText}>{importError}</Text>}

            <View style={{ marginTop: theme.spacing[5], gap: theme.spacing[3] }}>
                <Button title={busy ? 'Importing…' : 'Import key'} onPress={handleImport} disabled={busy} />
                <TouchableOpacity style={styles.skipLink} onPress={() => { setMode('choose'); setImportError(null); }} disabled={busy}>
                    <Text style={styles.skipLinkText}>Back</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            <ScreenHeader title="Nostr Setup" showBack={!isInitialSetup} />
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    {mode === 'choose' ? renderChoose() : renderImport()}
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.secondary,
    },
    scroll: {
        flexGrow: 1,
    },
    body: {
        flex: 1,
        padding: theme.spacing[6],
    },
    hero: {
        alignItems: 'center',
        marginBottom: theme.spacing[8],
    },
    heroIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: theme.colors.primary[50],
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: theme.spacing[4],
    },
    title: {
        fontSize: theme.typography.fontSize['2xl'],
        fontWeight: '700',
        color: theme.colors.text.primary,
        marginBottom: theme.spacing[2],
        textAlign: 'center',
    },
    subtitle: {
        fontSize: theme.typography.fontSize.base,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        lineHeight: leading(theme.typography.fontSize.base, theme.typography.lineHeight.snug),
        paddingHorizontal: theme.spacing[2],
    },
    optionList: {
        gap: theme.spacing[3],
    },
    optionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: theme.spacing[4],
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border.light,
        gap: theme.spacing[3],
    },
    optionCardDisabled: {
        opacity: 0.5,
    },
    optionIcon: {
        width: 48,
        height: 48,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.surface.tertiary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionText: {
        flex: 1,
    },
    optionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
        marginBottom: 2,
    },
    optionTitle: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    recommendedBadge: {
        paddingHorizontal: theme.spacing[2],
        paddingVertical: 2,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.primary[50],
    },
    recommendedText: {
        fontSize: 10,
        fontWeight: '700',
        color: theme.colors.primary[500],
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    optionDesc: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.snug),
    },
    inputLabel: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.primary,
        marginBottom: theme.spacing[2],
    },
    input: {
        backgroundColor: theme.colors.surface.primary,
        borderWidth: 1,
        borderColor: theme.colors.border.medium,
        borderRadius: theme.borderRadius.lg,
        paddingHorizontal: theme.spacing[4],
        paddingVertical: theme.spacing[3],
        minHeight: 80,
        fontSize: theme.typography.fontSize.base,
        color: theme.colors.text.primary,
        textAlignVertical: 'top',
    },
    errorText: {
        marginTop: theme.spacing[3],
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.error[500],
    },
    footer: {
        marginTop: 'auto',
        paddingTop: theme.spacing[6],
    },
    skipLink: {
        alignItems: 'center',
        paddingVertical: theme.spacing[2],
    },
    skipLinkText: {
        fontSize: theme.typography.fontSize.base,
        color: theme.colors.text.tertiary,
        fontWeight: '500',
    },
});
