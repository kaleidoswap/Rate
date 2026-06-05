// screens/WalletSettingsScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert, TouchableOpacity, StatusBar } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import { updateNetwork, deleteWallet } from '../store/slices/walletSlice';
import { theme } from '../theme';
import { NetworkType, NetworkConfig, WalletRecord } from '../services/DatabaseService';
import { Button, Input, Card } from '../components';
import { SecurityService } from '../services/SecurityService';
import { RevealMnemonicModal } from '../components/RevealMnemonicModal';

interface Props {
    navigation: any;
    route: any;
}

export default function WalletSettingsScreen({ navigation, route }: Props) {
    const { walletId } = route.params;
    const dispatch = useDispatch();
    const { wallets } = useSelector((state: RootState) => state.wallet);
    const wallet = wallets.find((w: WalletRecord) => w.id === walletId);

    const [rlnRemoteUrl, setRlnRemoteUrl] = useState('');
    const [isEditingRln, setIsEditingRln] = useState(false);
    const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null);
    const [showRevealModal, setShowRevealModal] = useState(false);

    // Auth-gated recovery-phrase reveal: require device authentication (biometric
    // or passcode) before reading the seed from the secure enclave. When no device
    // lock exists, warn explicitly before showing it.
    const handleViewMnemonic = async () => {
        if (typeof walletId !== 'number') return;
        const security = SecurityService.getInstance();
        const reveal = async () => {
            const mnemonic = await security.getMnemonic(walletId);
            if (!mnemonic) {
                Alert.alert('Unavailable', 'No recovery phrase is stored for this wallet on this device.');
                return;
            }
            setRevealedMnemonic(mnemonic);
            setShowRevealModal(true);
        };

        const canAuth = await security.isDeviceAuthAvailable();
        if (canAuth) {
            const ok = await security.authenticateForReveal();
            if (!ok) return;
            await reveal();
        } else {
            Alert.alert(
                'No device lock',
                'Your device has no biometric or passcode lock, so your recovery phrase cannot be protected here. Make sure no one is watching before continuing.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Show anyway', style: 'destructive', onPress: reveal },
                ],
            );
        }
    };

    const closeRevealModal = () => {
        setShowRevealModal(false);
        // Drop the plaintext seed from component state as soon as the sheet closes.
        setRevealedMnemonic(null);
    };

    useEffect(() => {
        if (wallet) {
            const rlnConfig = wallet.networks?.find((n: NetworkConfig) => n.type === 'rln');
            if (rlnConfig && rlnConfig.config) {
                try {
                    const parsed = JSON.parse(rlnConfig.config);
                    if (parsed.url) setRlnRemoteUrl(parsed.url);
                } catch (e) {
                    // ignore
                }
            }
        }
    }, [wallet]);

    if (!wallet) {
        return (
            <View style={styles.container}>
                <Text>Wallet not found</Text>
            </View>
        );
    }

    const handleToggleNetwork = async (type: NetworkType, enabled: boolean) => {
        if (!wallet || !wallet.id) return;
        // @ts-ignore
        await dispatch(updateNetwork({
            walletId: wallet.id,
            type,
            config: { enabled }
        }));
    };

    const handleSaveRlnConfig = async () => {
        if (!wallet || !wallet.id) return;
        const rlnConfig = wallet.networks?.find((n: NetworkConfig) => n.type === 'rln');
        const currentConfig = rlnConfig?.config ? JSON.parse(rlnConfig.config) : {};

        const newConfig = {
            ...currentConfig,
            url: rlnRemoteUrl
        };

        // @ts-ignore
        await dispatch(updateNetwork({
            walletId: wallet.id,
            type: 'rln',
            config: { config: JSON.stringify(newConfig) }
        }));
        setIsEditingRln(false);
    };

    const handleDeleteWallet = () => {
        if (!wallet || !wallet.id) return;
        Alert.alert(
            'Delete Wallet',
            'Are you sure you want to delete this wallet? This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            // @ts-ignore
                            await dispatch(deleteWallet(wallet.id)).unwrap();
                            navigation.goBack();
                        } catch (error: any) {
                            Alert.alert('Error', error.message);
                        }
                    }
                }
            ]
        );
    };

    const renderNetworkItem = (type: NetworkType, label: string, icon: keyof typeof Ionicons.glyphMap) => {
        const network = wallet.networks?.find((n: NetworkConfig) => n.type === type);
        const isEnabled = network?.enabled ?? false;

        return (
            <View style={styles.networkItemContainer}>
                <View style={styles.networkHeader}>
                    <View style={styles.networkLabelContainer}>
                        <View style={[styles.iconContainer, { backgroundColor: isEnabled ? theme.colors.primary[100] : theme.colors.gray[100] }]}>
                            <Ionicons
                                name={icon}
                                size={20}
                                color={isEnabled ? theme.colors.primary[600] : theme.colors.gray[500]}
                            />
                        </View>
                        <Text style={styles.networkLabel}>{label}</Text>
                    </View>
                    <Switch
                        value={isEnabled}
                        onValueChange={(v) => handleToggleNetwork(type, v)}
                        trackColor={{ false: theme.colors.gray[300], true: theme.colors.primary[500] }}
                        thumbColor={theme.colors.surface.primary}
                    />
                </View>

                {type === 'rln' && isEnabled && (
                    <View style={styles.networkConfig}>
                        <Text style={styles.configLabel}>Remote Node URL</Text>
                        {isEditingRln ? (
                            <View style={styles.editContainer}>
                                <Input
                                    value={rlnRemoteUrl}
                                    onChangeText={setRlnRemoteUrl}
                                    placeholder="https://..."
                                    style={styles.input}
                                />
                                <View style={styles.buttonRow}>
                                    <Button title="Save" onPress={handleSaveRlnConfig} style={styles.smallButton} />
                                    <Button title="Cancel" onPress={() => setIsEditingRln(false)} variant="secondary" style={styles.smallButton} />
                                </View>
                            </View>
                        ) : (
                            <TouchableOpacity
                                style={styles.configDisplay}
                                onPress={() => setIsEditingRln(true)}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.configValue} numberOfLines={1}>
                                    {rlnRemoteUrl || 'Not configured'}
                                </Text>
                                <Ionicons name="pencil" size={16} color={theme.colors.primary[500]} />
                            </TouchableOpacity>
                        )}
                    </View>
                )}
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            <LinearGradient
                colors={theme.colors.primary.gradient || ['#4c669f', '#3b5998', '#192f6a']}
                style={styles.headerGradient}
            >
                <SafeAreaView edges={['top']} style={styles.safeArea}>
                    <View style={styles.header}>
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={() => navigation.goBack()}
                        >
                            <Ionicons name="arrow-back" size={24} color="white" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>{wallet.name}</Text>
                        <View style={styles.placeholder} />
                    </View>
                </SafeAreaView>
            </LinearGradient>

            <ScrollView
                style={styles.content}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                <Text style={styles.sectionHeader}>Networks</Text>
                <Card style={styles.card}>
                    {renderNetworkItem('spark', 'Spark Network', 'flash')}
                    <View style={styles.divider} />
                    {renderNetworkItem('arkade', 'Arkade', 'planet')}
                    <View style={styles.divider} />
                    {renderNetworkItem('rln', 'RGB Lightning Node', 'server')}
                </Card>

                <Text style={styles.sectionHeader}>Security</Text>
                <Card style={styles.card}>
                    <TouchableOpacity
                        style={styles.menuItem}
                        onPress={handleViewMnemonic}
                    >
                        <View style={styles.menuItemLeft}>
                            <View style={[styles.iconContainer, { backgroundColor: theme.colors.secondary[100] }]}>
                                <Ionicons name="key" size={20} color={theme.colors.secondary[600]} />
                            </View>
                            <Text style={styles.menuItemText}>View Mnemonic Phrase</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={theme.colors.gray[400]} />
                    </TouchableOpacity>
                </Card>

                <Text style={styles.sectionHeader}>Danger Zone</Text>
                <Card style={styles.dangerCard}>
                    <View style={styles.dangerContent}>
                        <Text style={styles.dangerText}>
                            Deleting this wallet will remove it from this device. Make sure you have your mnemonic phrase backed up.
                        </Text>
                        <Button
                            title="Delete Wallet"
                            onPress={handleDeleteWallet}
                            style={styles.deleteButton}
                            textStyle={styles.deleteButtonText}
                            variant="secondary"
                        />
                    </View>
                </Card>

                <View style={styles.footerSpacer} />
            </ScrollView>

            <RevealMnemonicModal
                visible={showRevealModal}
                mnemonic={revealedMnemonic}
                onClose={closeRevealModal}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.secondary,
    },
    headerGradient: {
        paddingBottom: theme.spacing[4],
    },
    safeArea: {
        marginBottom: 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing[5],
        paddingVertical: theme.spacing[2],
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: theme.borderRadius.full,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: theme.typography.fontSize.xl,
        fontWeight: '700',
        color: 'white',
    },
    placeholder: {
        width: 40,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        padding: theme.spacing[5],
    },
    sectionHeader: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.secondary,
        marginBottom: theme.spacing[3],
        marginTop: theme.spacing[2],
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    card: {
        padding: 0,
        overflow: 'hidden',
        marginBottom: theme.spacing[4],
    },
    networkItemContainer: {
        padding: theme.spacing[4],
    },
    networkHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    networkLabelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[3],
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: theme.borderRadius.base,
        alignItems: 'center',
        justifyContent: 'center',
    },
    networkLabel: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '500',
        color: theme.colors.text.primary,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.border.light,
        marginLeft: theme.spacing[4] + 36 + theme.spacing[3], // Align with text
    },
    networkConfig: {
        marginTop: theme.spacing[3],
        paddingLeft: 36 + theme.spacing[3], // Align with text
    },
    configLabel: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.tertiary,
        marginBottom: theme.spacing[2],
    },
    configDisplay: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: theme.colors.gray[50],
        padding: theme.spacing[3],
        borderRadius: theme.borderRadius.base,
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    configValue: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        flex: 1,
        marginRight: theme.spacing[2],
    },
    editContainer: {
        gap: theme.spacing[2],
    },
    input: {
        backgroundColor: theme.colors.surface.primary,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: theme.spacing[2],
        marginTop: theme.spacing[2],
    },
    smallButton: {
        flex: 1,
        paddingVertical: theme.spacing[2],
    },
    menuItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: theme.spacing[4],
    },
    menuItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[3],
    },
    menuItemText: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '500',
        color: theme.colors.text.primary,
    },
    dangerCard: {
        borderColor: theme.colors.error[200],
        borderWidth: 1,
        backgroundColor: theme.colors.error[50],
    },
    dangerContent: {
        gap: theme.spacing[4],
    },
    dangerText: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.error[700],
        lineHeight: 20,
    },
    deleteButton: {
        backgroundColor: 'white',
        borderColor: theme.colors.error[300],
    },
    deleteButtonText: {
        color: theme.colors.error[600],
    },
    footerSpacer: {
        height: 40,
    },
});
