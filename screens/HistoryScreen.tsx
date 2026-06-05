
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { StatusBar } from 'react-native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { RootState } from '../store';
import { MainHeader, Card } from '../components';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusType } from '@kaleidorg/kaleido-ui/native';
import { theme } from '../theme';

// Map domain transaction statuses to kaleido-ui StatusBadge types
const toBadgeStatus = (s: Transaction['status']): StatusType => {
    if (s === 'completed') return 'completed';
    if (s === 'failed') return 'failed';
    return 'pending'; // 'whitelisted' | 'executing' | 'pending'
};

// Define transaction types
type TransactionType = 'deposit' | 'withdraw' | 'swap';

interface Transaction {
    id: string;
    type: TransactionType;
    amount: number;
    asset: string;
    date: number;
    status: 'completed' | 'pending' | 'failed' | 'whitelisted' | 'executing';
    txid?: string;
    toAmount?: number; // For swaps
    toAsset?: string; // For swaps
}

export default function HistoryScreen() {
    const navigation = useNavigation();
    const swapHistory = useSelector((state: RootState) => state.swap.swapHistory);
    const [history, setHistory] = useState<Transaction[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        loadHistory();
    }, [swapHistory]);

    const loadHistory = () => {
        // 1. Convert Swap History
        const swaps: Transaction[] = swapHistory.map(swap => {
            // We need to find quote info if stored, but swapHistory only stores execution currently.
            // If we don't have amounts in execution, we might need to rely on what we have.
            // However, looking at swapSlice, SwapExecution doesn't have amounts.
            // We might need to enrich this in the future.
            // For now, let's just show it as a Swap interaction.
            return {
                id: swap.rfq_id,
                type: 'swap',
                amount: 0, // Placeholder as we don't store amount in execution history yet
                asset: 'BTC/RGB',
                date: swap.created_at,
                status: swap.status,
                txid: swap.txid
            };
        });

        // 2. Mock Deposits/Withdrawals
        const mockTx: Transaction[] = [
            {
                id: 'tx-1',
                type: 'deposit',
                amount: 0.05,
                asset: 'BTC',
                date: Date.now() - 10000000,
                status: 'completed',
                txid: 'abcdef123456'
            },
            {
                id: 'tx-2',
                type: 'withdraw',
                amount: 100,
                asset: 'USDT',
                date: Date.now() - 50000000,
                status: 'completed'
            },
            {
                id: 'tx-3',
                type: 'deposit',
                amount: 500,
                asset: 'L-BTC',
                date: Date.now() - 2000000,
                status: 'pending'
            }
        ];

        // Merge and sort by date descending
        const allHistory = [...swaps, ...mockTx].sort((a, b) => b.date - a.date);
        setHistory(allHistory);
    };

    const onRefresh = () => {
        setRefreshing(true);
        loadHistory();
        setTimeout(() => setRefreshing(false), 1000);
    };

    const getIcon = (type: TransactionType) => {
        switch (type) {
            case 'deposit': return 'arrow-down';
            case 'withdraw': return 'arrow-up';
            case 'swap': return 'swap-horizontal';
        }
    };

    const getColor = (type: TransactionType) => {
        switch (type) {
            case 'deposit': return theme.colors.success[500];
            case 'withdraw': return theme.colors.error[500];
            case 'swap': return theme.colors.warning[500];
        }
    };

    const renderItem = ({ item }: { item: Transaction }) => (
        <Card style={styles.card}>
            <View style={styles.row}>
                <View style={[styles.iconContainer, { backgroundColor: getColor(item.type) + '20' }]}>
                    <Ionicons name={getIcon(item.type)} size={20} color={getColor(item.type)} />
                </View>

                <View style={styles.details}>
                    <Text style={styles.typeText}>{item.type.charAt(0).toUpperCase() + item.type.slice(1)}</Text>
                    <Text style={styles.dateText}>{new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString()}</Text>
                </View>

                <View style={styles.amountContainer}>
                    <Text style={[styles.amountText, { color: item.type === 'deposit' ? theme.colors.success[500] : theme.colors.text.primary }]}>
                        {item.type === 'deposit' ? '+' : '-'}{item.amount > 0 ? item.amount : '?'} {item.asset}
                    </Text>
                    <StatusBadge status={toBadgeStatus(item.status)} style={styles.statusText} />
                </View>
            </View>
        </Card>
    );

    return (
        <View style={styles.container}>
            {/* Ensure header background handles status bar area */}
            <StatusBar barStyle="light-content" />
            <MainHeader
                title="History"
                onBack={() => navigation.goBack()}
            />

            <FlatList
                data={history}
                renderItem={renderItem}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary[500]} />}
                ListEmptyComponent={
                    <EmptyState
                        icon="receipt-outline"
                        title="No transactions yet"
                        message="Your payments and asset transfers will appear here once you send or receive."
                    />
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.secondary,
    },
    listContent: {
        padding: theme.spacing[4],
    },
    card: {
        marginBottom: theme.spacing[3],
        padding: theme.spacing[3],
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing[3],
    },
    details: {
        flex: 1,
    },
    typeText: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    dateText: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.tertiary,
        marginTop: 2,
    },
    amountContainer: {
        alignItems: 'flex-end',
    },
    amountText: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
    },
    statusText: {
        fontSize: theme.typography.fontSize.xs,
        marginTop: 2,
        textTransform: 'capitalize',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: theme.spacing[10],
    },
    emptyText: {
        marginTop: theme.spacing[3],
        color: theme.colors.text.secondary,
        fontSize: theme.typography.fontSize.base,
    }
});
