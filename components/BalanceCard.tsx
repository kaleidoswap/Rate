import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { NetworkIcon } from './NetworkIcon';
import { Skeleton } from './Skeleton';

interface ProtocolBalance {
    confirmed: number;
    unconfirmed: number;
    total: number;
}

interface BalanceCardProps {
    totalBalance: number;
    bitcoinUnit: string;
    onRefresh: () => void;
    refreshing: boolean;
    formatSatoshis: (amount: number) => string;
    formatUSD: (amount: number) => string;
    onChainBalance: number;
    lightningBalance: number;
    byProtocol?: {
        RGB?: ProtocolBalance;
        SPARK?: ProtocolBalance;
        ARKADE?: ProtocolBalance;
    };
    /** Show shimmer placeholders instead of the balance while first loading. */
    loading?: boolean;
    /**
     * Denomination-aware display (sats / BTC / fiat). When `primaryText` is
     * provided it overrides the `formatSatoshis`/`bitcoinUnit`/USD rendering of
     * the total, and tapping the balance calls `onCycleDenomination`.
     */
    primaryText?: string;
    primaryUnitLabel?: string;
    secondaryText?: string;
    onCycleDenomination?: () => void;
}

const PROTOCOL_DISPLAY: Array<{ key: string; label: string; color: string }> = [
    { key: 'RGB', label: 'RLN', color: '#2BEE79' },
    { key: 'SPARK', label: 'Spark', color: '#60A5FA' },
    { key: 'ARKADE', label: 'Arkade', color: '#A855F7' },
];

export const BalanceCard: React.FC<BalanceCardProps> = ({
    totalBalance,
    bitcoinUnit,
    onRefresh,
    refreshing,
    formatSatoshis,
    formatUSD,
    byProtocol,
    loading,
    primaryText,
    primaryUnitLabel,
    secondaryText,
    onCycleDenomination,
}) => {
    const useDenominated = primaryText !== undefined;
    // Filter to only protocols with balance data
    const activeProtocols = byProtocol
        ? PROTOCOL_DISPLAY.filter(p => byProtocol[p.key as keyof typeof byProtocol])
        : [];

    return (
        <View style={styles.container}>
            {/* Total balance */}
            <View style={styles.totalBalanceContainer}>
                <Text style={styles.balanceLabel}>Total Balance</Text>
                {loading ? (
                    <View style={{ gap: 10, marginTop: 4 }}>
                        <Skeleton width={180} height={34} radius={10} style={{ backgroundColor: 'rgba(255,255,255,0.18)' }} />
                        <Skeleton width={110} height={15} radius={7} style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    </View>
                ) : useDenominated ? (
                    <TouchableOpacity
                        activeOpacity={onCycleDenomination ? 0.6 : 1}
                        onPress={onCycleDenomination}
                        disabled={!onCycleDenomination}
                        accessibilityRole="button"
                        accessibilityLabel={`Total balance ${primaryText} ${primaryUnitLabel ?? ''}. Tap to change denomination.`}
                    >
                        <View style={styles.balanceRow}>
                            <Text style={styles.balanceAmount}>{primaryText}</Text>
                            {!!primaryUnitLabel && (
                                <Text style={styles.balanceCurrency}>{primaryUnitLabel}</Text>
                            )}
                        </View>
                        <Text style={styles.balanceUsd}>{secondaryText ?? ''}</Text>
                    </TouchableOpacity>
                ) : (
                    <>
                        <View style={styles.balanceRow}>
                            <Text style={styles.balanceAmount}>
                                {formatSatoshis(totalBalance)}
                            </Text>
                            <Text style={styles.balanceCurrency}>{bitcoinUnit}</Text>
                        </View>
                        <Text style={styles.balanceUsd}>
                            {formatUSD(totalBalance) !== '0.00' ? `$${formatUSD(totalBalance)} USD` : ''}
                        </Text>
                    </>
                )}
            </View>

            {/* Refresh button */}
            <TouchableOpacity
                style={styles.refreshButton}
                onPress={onRefresh}
                disabled={refreshing}
            >
                <Ionicons
                    name="refresh"
                    size={16}
                    color="rgba(255,255,255,0.8)"
                    style={refreshing ? { transform: [{ rotate: '180deg' }] } : {}}
                />
            </TouchableOpacity>

            {/* Per-protocol breakdown (only show protocols with data) */}
            {activeProtocols.length > 0 && (
                <View style={styles.balanceBreakdown}>
                    {activeProtocols.map((proto, idx) => {
                        const bal = (byProtocol as any)[proto.key] as ProtocolBalance;
                        return (
                            <React.Fragment key={proto.key}>
                                {idx > 0 && <View style={styles.breakdownDivider} />}
                                <View style={styles.breakdownItem}>
                                    <View style={[styles.breakdownIcon, { backgroundColor: proto.color + '25' }]}>
                                        <NetworkIcon network={proto.key} size={16} color={proto.color} />
                                    </View>
                                    <View style={styles.breakdownText}>
                                        <Text style={styles.breakdownLabel}>{proto.label}</Text>
                                        <Text style={styles.breakdownValue}>
                                            {formatSatoshis(bal.total)} <Text style={styles.breakdownUnit}>{bitcoinUnit}</Text>
                                        </Text>
                                    </View>
                                </View>
                            </React.Fragment>
                        );
                    })}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },
    totalBalanceContainer: {
        alignItems: 'center',
        marginBottom: 16,
    },
    balanceLabel: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.7)',
        marginBottom: 4,
    },
    balanceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: 4,
    },
    balanceAmount: {
        fontSize: 36,
        fontWeight: '800',
        color: '#fff',
        marginRight: 8,
    },
    balanceCurrency: {
        fontSize: 18,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.85)',
    },
    balanceUsd: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.65)',
        minHeight: 18,
    },
    refreshButton: {
        position: 'absolute',
        top: 8,
        right: 16,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.12)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    balanceBreakdown: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 8,
    },
    breakdownItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    breakdownIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    breakdownText: {
        justifyContent: 'center',
    },
    breakdownLabel: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.6)',
        marginBottom: 1,
    },
    breakdownValue: {
        fontSize: 13,
        fontWeight: '600',
        color: '#fff',
    },
    breakdownUnit: {
        fontSize: 10,
        fontWeight: '400',
        color: 'rgba(255,255,255,0.5)',
    },
    breakdownDivider: {
        width: 1,
        backgroundColor: 'rgba(255,255,255,0.12)',
        marginHorizontal: 4,
    },
});
