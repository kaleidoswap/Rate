// screens/AddWalletScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Switch, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useDispatch } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { createNewWallet } from '../store/slices/walletSlice';
import { theme } from '../theme';
import { NetworkType, NetworkConfig } from '../services/DatabaseService';
import { Button, Input } from '../components';
import { RGBApiService } from '../services/RGBApiService';

interface Props {
    navigation: any;
}

export default function AddWalletScreen({ navigation }: Props) {
    const dispatch = useDispatch();
    const [name, setName] = useState('');
    const [mnemonic, setMnemonic] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    // Network selection state
    const [networks, setNetworks] = useState<{ [key in NetworkType]: boolean }>({
        spark: true,
        liquid: false,
        arkade: false,
        rln: false,
    });

    // RLN Config
    const [rlnType, setRlnType] = useState<'local' | 'remote'>('remote');
    const [rlnRemoteUrl, setRlnRemoteUrl] = useState('');

    useEffect(() => {
        handleGenerateMnemonic();
    }, []);

    const handleGenerateMnemonic = async () => {
        setIsGenerating(true);
        try {
            const apiService = RGBApiService.getInstance();
            // Placeholder for mnemonic generation
            const mockMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            setMnemonic(mockMnemonic);
        } catch (error) {
            Alert.alert('Error', 'Failed to generate mnemonic');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCreate = async () => {
        if (!name.trim()) {
            Alert.alert('Error', 'Please enter a wallet name');
            return;
        }
        if (!mnemonic) {
            Alert.alert('Error', 'Please generate or import a mnemonic');
            return;
        }

        try {
            const selectedNetworks: Omit<NetworkConfig, 'id' | 'wallet_id'>[] = [];

            if (networks.spark) {
                selectedNetworks.push({ type: 'spark', enabled: true, config: '{}' });
            }
            if (networks.liquid) {
                selectedNetworks.push({ type: 'liquid', enabled: true, config: '{}' });
            }
            if (networks.arkade) {
                selectedNetworks.push({ type: 'arkade', enabled: true, config: '{}' });
            }
            if (networks.rln) {
                selectedNetworks.push({
                    type: 'rln',
                    enabled: true,
                    config: JSON.stringify({ type: rlnType, url: rlnRemoteUrl })
                });
            }

            // @ts-ignore
            await dispatch(createNewWallet({
                name,
                mnemonic,
                networks: selectedNetworks
            })).unwrap();

            // Enforce single wallet: Go to Dashboard and reset stack to prevent going back
            navigation.reset({
                index: 0,
                routes: [{ name: 'Dashboard' }],
            });
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to create wallet');
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="arrow-back" size={24} color={theme.colors.text.primary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Add Wallet</Text>
                <View style={styles.placeholder} />
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardAvoid}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
            >
                <ScrollView
                    style={styles.content}
                    contentContainerStyle={styles.contentContainer}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Basic Info</Text>
                        <Input
                            label="Wallet Name"
                            value={name}
                            onChangeText={setName}
                            placeholder="My Wallet"
                            style={styles.inputSpacing}
                            returnKeyType="next"
                        />
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Security</Text>
                        <Text style={styles.label}>Mnemonic Phrase</Text>
                        <View style={styles.mnemonicContainer}>
                            <Text style={styles.mnemonicText}>
                                {mnemonic || 'Generating...'}
                            </Text>
                        </View>
                        <Button
                            title="Regenerate"
                            onPress={handleGenerateMnemonic}
                            disabled={isGenerating}
                            variant="secondary"
                            style={styles.regenerateButton}
                        />
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Networks</Text>

                        <View style={styles.networkItem}>
                            <Text style={styles.networkLabel}>Spark</Text>
                            <Switch
                                value={networks.spark}
                                onValueChange={(v) => setNetworks(prev => ({ ...prev, spark: v }))}
                            />
                        </View>

                        <View style={styles.networkItem}>
                            <Text style={styles.networkLabel}>Liquid</Text>
                            <Switch
                                value={networks.liquid}
                                onValueChange={(v) => setNetworks(prev => ({ ...prev, liquid: v }))}
                            />
                        </View>

                        <View style={styles.networkItem}>
                            <Text style={styles.networkLabel}>Arkade</Text>
                            <Switch
                                value={networks.arkade}
                                onValueChange={(v) => setNetworks(prev => ({ ...prev, arkade: v }))}
                            />
                        </View>

                        <View style={styles.networkItem}>
                            <Text style={styles.networkLabel}>RGB Lightning Node (RLN)</Text>
                            <Switch
                                value={networks.rln}
                                onValueChange={(v) => setNetworks(prev => ({ ...prev, rln: v }))}
                            />
                        </View>

                        {networks.rln && (
                            <View style={styles.subSection}>
                                <Text style={styles.subLabel}>RLN Type</Text>
                                <View style={styles.radioGroup}>
                                    <TouchableOpacity
                                        style={[styles.radioButton, rlnType === 'local' && styles.radioButtonActive]}
                                        onPress={() => setRlnType('local')}
                                    >
                                        <Text style={[styles.radioText, rlnType === 'local' && styles.radioTextActive]}>Local</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.radioButton, rlnType === 'remote' && styles.radioButtonActive]}
                                        onPress={() => setRlnType('remote')}
                                    >
                                        <Text style={[styles.radioText, rlnType === 'remote' && styles.radioTextActive]}>Remote</Text>
                                    </TouchableOpacity>
                                </View>

                                {rlnType === 'remote' && (
                                    <Input
                                        label="Remote Node URL"
                                        value={rlnRemoteUrl}
                                        onChangeText={setRlnRemoteUrl}
                                        placeholder="https://..."
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="url"
                                    />
                                )}
                            </View>
                        )}
                    </View>

                    <Button
                        title="Create Wallet"
                        onPress={handleCreate}
                        style={styles.createButton}
                    />
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.secondary,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing[5],
        paddingVertical: theme.spacing[4],
        backgroundColor: theme.colors.surface.primary,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.light,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: theme.borderRadius.base,
        backgroundColor: theme.colors.gray[100],
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: theme.typography.fontSize.xl,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    placeholder: {
        width: 40,
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: theme.spacing[5],
        paddingBottom: 150,
    },
    section: {
        marginBottom: theme.spacing[6],
        backgroundColor: theme.colors.surface.primary,
        padding: theme.spacing[4],
        borderRadius: theme.borderRadius.lg,
    },
    sectionTitle: {
        fontSize: theme.typography.fontSize.lg,
        fontWeight: '600',
        color: theme.colors.text.primary,
        marginBottom: theme.spacing[4],
    },
    label: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        marginBottom: theme.spacing[2],
    },
    mnemonicContainer: {
        backgroundColor: theme.colors.gray[50],
        padding: theme.spacing[3],
        borderRadius: theme.borderRadius.base,
        marginBottom: theme.spacing[3],
        minHeight: 80,
        justifyContent: 'center',
    },
    mnemonicText: {
        fontSize: theme.typography.fontSize.base,
        color: theme.colors.text.primary,
        textAlign: 'center',
    },
    regenerateButton: {
        marginTop: theme.spacing[2],
    },
    networkItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing[3],
    },
    networkLabel: {
        fontSize: theme.typography.fontSize.base,
        color: theme.colors.text.primary,
    },
    subSection: {
        marginTop: theme.spacing[2],
        paddingLeft: theme.spacing[2],
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.gray[200],
    },
    subLabel: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        marginBottom: theme.spacing[2],
    },
    radioGroup: {
        flexDirection: 'row',
        gap: theme.spacing[2],
        marginBottom: theme.spacing[3],
    },
    radioButton: {
        paddingHorizontal: theme.spacing[3],
        paddingVertical: theme.spacing[2],
        borderRadius: theme.borderRadius.base,
        borderWidth: 1,
        borderColor: theme.colors.gray[300],
    },
    radioButtonActive: {
        backgroundColor: theme.colors.primary[50],
        borderColor: theme.colors.primary[500],
    },
    radioText: {
        color: theme.colors.text.secondary,
    },
    radioTextActive: {
        color: theme.colors.primary[500],
        fontWeight: '600',
    },
    createButton: {
        marginBottom: theme.spacing[8],
    },
    keyboardAvoid: {
        flex: 1,
    },
    inputSpacing: {
        marginBottom: theme.spacing[4],
    },
});
