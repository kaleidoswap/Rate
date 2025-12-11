import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

interface BalanceCardProps {
    totalBalance: number;
    bitcoinUnit: string;
    onRefresh: () => void;
    refreshing: boolean;
    formatSatoshis: (amount: number) => string;
    formatUSD: (amount: number) => string;
    onChainBalance: number;
    lightningBalance: number;
}

export const BalanceCard: React.FC<BalanceCardProps> = ({
    totalBalance,
    bitcoinUnit,
    onRefresh,
    refreshing,
    formatSatoshis,
    formatUSD,
    onChainBalance,
    lightningBalance,
}) => {
    return (
        <View style={styles.container}>
            <View style={styles.totalBalanceContainer}>
                <Text style={styles.balanceLabel}>Total Portfolio</Text>
                <View style={styles.balanceRow}>
                    <Text style={styles.balanceAmount}>
                        {formatSatoshis(totalBalance)}
                    </Text>
                    <Text style={styles.balanceCurrency}>{bitcoinUnit}</Text>
                </View>
                <Text style={styles.balanceUsd}>
                    ${formatUSD(totalBalance)} USD
                </Text>

                {/* Price Change Indicator - Mocked for now */}
                <View style={styles.priceChangeContainer}>
                    <Ionicons name="trending-up" size={12} color={theme.colors.success[500]} />
                    <Text style={styles.priceChange}>+2.4% today</Text>
                </View>
            </View>

            <TouchableOpacity
                style={styles.refreshButton}
                onPress={onRefresh}
                disabled={refreshing}
            >
                <Ionicons
                    name="refresh"
                    size={16}
                    color={theme.colors.text.inverse}
                    style={refreshing ? { transform: [{ rotate: '180deg' }] } : {}}
                />
            </TouchableOpacity>

            {/* Balance Breakdown */}
            <View style={styles.balanceBreakdown}>
                <View style={styles.breakdownItem}>
                    <View style={styles.breakdownIcon}>
                        <Ionicons name="wallet" size={14} color={theme.colors.success[500]} />
                    </View>
                    <View style={styles.breakdownText}>
                        <Text style={styles.breakdownLabel}>On-chain</Text>
                        <Text style={styles.breakdownValue}>
                            {formatSatoshis(onChainBalance)}
                        </Text>
                    </View>
                </View>

                <View style={styles.breakdownDivider} />

                <View style={styles.breakdownItem}>
                    <View style={styles.breakdownIcon}>
                        <Ionicons name="flash" size={14} color={theme.colors.warning[500]} />
                    </View>
                    <View style={styles.breakdownText}>
                        <Text style={styles.breakdownLabel}>Lightning</Text>
                        <Text style={styles.breakdownValue}>
                            {formatSatoshis(lightningBalance)}
                        </Text>
                    </View>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: theme.spacing[4],
    },
    totalBalanceContainer: {
        alignItems: 'center',
        marginBottom: theme.spacing[6],
    },
    balanceLabel: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.inverse,
        opacity: 0.8,
        marginBottom: theme.spacing[1],
    },
    balanceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: theme.spacing[1],
    },
    balanceAmount: {
        fontSize: theme.typography.fontSize['4xl'],
        fontWeight: '700',
        color: theme.colors.text.inverse,
        marginRight: theme.spacing[2],
    },
    balanceCurrency: {
        fontSize: theme.typography.fontSize.xl,
        fontWeight: '500',
        color: theme.colors.text.inverse,
        opacity: 0.9,
    },
    balanceUsd: {
        fontSize: theme.typography.fontSize.base,
        color: theme.colors.text.inverse,
        opacity: 0.8,
        marginBottom: theme.spacing[2],
    },
    priceChangeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        paddingHorizontal: theme.spacing[2],
        paddingVertical: theme.spacing[1],
        borderRadius: theme.borderRadius.full,
    },
    priceChange: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.success[500], // Using success color for positive change
        marginLeft: theme.spacing[1],
        fontWeight: '500',
    },
    refreshButton: {
        position: 'absolute',
        top: theme.spacing[4],
        right: theme.spacing[4],
        padding: theme.spacing[2],
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: theme.borderRadius.full,
    },
    balanceBreakdown: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing[4],
        marginTop: theme.spacing[2],
    },
    breakdownItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    breakdownIcon: {
        width: 32,
        height: 32,
        borderRadius: theme.borderRadius.full,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing[3],
    },
    breakdownText: {
        justifyContent: 'center',
    },
    breakdownLabel: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.inverse,
        opacity: 0.7,
        marginBottom: 2,
    },
    breakdownValue: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.inverse,
    },
    breakdownDivider: {
        width: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginHorizontal: theme.spacing[2],
    },
});
