// screens/WalletListScreen.tsx
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import { switchWallet, loadWallets } from '../store/slices/walletSlice';
import { theme } from '../theme';
import { WalletRecord } from '../services/DatabaseService';

interface Props {
    navigation: any;
}

export default function WalletListScreen({ navigation }: Props) {
    const dispatch = useDispatch();
    const { wallets, activeWallet, isLoading } = useSelector((state: RootState) => state.wallet);

    useEffect(() => {
        // Load wallets when screen mounts
        // @ts-ignore
        dispatch(loadWallets());
    }, [dispatch]);

    const handleSwitchWallet = async (wallet: WalletRecord) => {
        if (activeWallet?.id === wallet.id) {
            // Already active, just go to Dashboard
            navigation.reset({
                index: 0,
                routes: [{ name: 'Dashboard' }],
            });
            return;
        }

        try {
            // @ts-ignore
            await dispatch(switchWallet(wallet.id!)).unwrap();
            // Switched successfully, go to Dashboard
            navigation.reset({
                index: 0,
                routes: [{ name: 'Dashboard' }],
            });
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to switch wallet');
        }
    };

    const renderWalletItem = ({ item }: { item: WalletRecord }) => {
        const isActive = activeWallet?.id === item.id;

        return (
            <TouchableOpacity
                style={[styles.walletCard, isActive && styles.activeWalletCard]}
                onPress={() => handleSwitchWallet(item)}
            >
                <View style={styles.walletInfo}>
                    <View style={styles.walletHeader}>
                        <Text style={[styles.walletName, isActive && styles.activeWalletText]}>
                            {item.name}
                        </Text>
                        {isActive && (
                            <View style={styles.activeBadge}>
                                <Text style={styles.activeBadgeText}>Active</Text>
                            </View>
                        )}
                    </View>
                    <Text style={[styles.walletDate, isActive && styles.activeWalletText]}>
                        Created: {new Date(item.created_at).toLocaleDateString()}
                    </Text>
                    <View style={styles.networksContainer}>
                        {item.networks?.map((net, index) => (
                            <View key={index} style={styles.networkBadge}>
                                <Text style={styles.networkBadgeText}>{net.type}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={() => navigation.navigate('WalletSettings', { walletId: item.id })}
                >
                    <Ionicons
                        name="settings-outline"
                        size={24}
                        color={isActive ? '#fff' : theme.colors.text.secondary}
                    />
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                {wallets.length > 0 ? (
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text.primary} />
                    </TouchableOpacity>
                ) : (
                    <View style={styles.backButton} />
                )}
                <Text style={styles.headerTitle}>{wallets.length > 0 ? 'My Wallets' : 'Welcome'}</Text>
                <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => navigation.navigate('AddWallet')}
                >
                    <Ionicons name="add" size={24} color={theme.colors.primary[500]} />
                </TouchableOpacity>
            </View>

            <FlatList
                data={wallets}
                renderItem={renderWalletItem}
                keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <View style={styles.welcomeIcon}>
                            <Ionicons name="wallet-outline" size={64} color={theme.colors.primary[500]} />
                        </View>
                        <Text style={styles.welcomeTitle}>Welcome to KaleidoSwap</Text>
                        <Text style={styles.welcomeSubtitle}>
                            Your secure gateway to the Lightning Network and RGB assets.
                        </Text>
                        <TouchableOpacity
                            style={styles.createButton}
                            onPress={() => navigation.navigate('AddWallet')}
                        >
                            <Text style={styles.createButtonText}>Create New Wallet</Text>
                        </TouchableOpacity>
                    </View>
                }
            />
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
    addButton: {
        width: 40,
        height: 40,
        borderRadius: theme.borderRadius.base,
        backgroundColor: theme.colors.primary[50],
        alignItems: 'center',
        justifyContent: 'center',
    },
    listContent: {
        padding: theme.spacing[5],
    },
    walletCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing[4],
        marginBottom: theme.spacing[3],
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3.84,
        elevation: 5,
    },
    activeWalletCard: {
        backgroundColor: theme.colors.primary[500],
    },
    walletInfo: {
        flex: 1,
    },
    walletHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: theme.spacing[1],
    },
    walletName: {
        fontSize: theme.typography.fontSize.lg,
        fontWeight: '600',
        color: theme.colors.text.primary,
        marginRight: theme.spacing[2],
    },
    activeWalletText: {
        color: '#fff',
    },
    activeBadge: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: theme.spacing[2],
        paddingVertical: 2,
        borderRadius: theme.borderRadius.sm,
    },
    activeBadgeText: {
        color: '#fff',
        fontSize: theme.typography.fontSize.xs,
        fontWeight: '600',
    },
    walletDate: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        marginBottom: theme.spacing[2],
    },
    networksContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.spacing[2],
    },
    networkBadge: {
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        paddingHorizontal: theme.spacing[2],
        paddingVertical: 2,
        borderRadius: theme.borderRadius.sm,
    },
    networkBadgeText: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.primary, // Or white if active, but simpler to keep generic or adjust
    },
    settingsButton: {
        padding: theme.spacing[2],
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.spacing[6],
        marginTop: theme.spacing[20],
    },
    welcomeIcon: {
        marginBottom: theme.spacing[6],
        padding: theme.spacing[6],
        backgroundColor: theme.colors.primary[50],
        borderRadius: theme.borderRadius.full,
    },
    welcomeTitle: {
        fontSize: theme.typography.fontSize['3xl'],
        fontWeight: '700',
        color: theme.colors.text.primary,
        marginBottom: theme.spacing[2],
        textAlign: 'center',
    },
    welcomeSubtitle: {
        fontSize: theme.typography.fontSize.lg,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        marginBottom: theme.spacing[8],
        lineHeight: 24,
    },
    createButton: {
        backgroundColor: theme.colors.primary[500],
        paddingHorizontal: theme.spacing[8],
        paddingVertical: theme.spacing[4],
        borderRadius: theme.borderRadius.xl,
        width: '100%',
        alignItems: 'center',
        shadowColor: theme.colors.primary[500],
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    createButtonText: {
        color: '#fff',
        fontSize: theme.typography.fontSize.lg,
        fontWeight: '600',
    },
});
