import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, protocolColor } from '../theme';
import { NetworkIcon } from './NetworkIcon';
import { Skeleton } from './Skeleton';
import { AmountText } from './AmountText';

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
    { key: 'RGB', label: 'RLN', color: protocolColor('RGB') },
    { key: 'SPARK', label: 'Spark', color: protocolColor('SPARK') },
    { key: 'ARKADE', label: 'Arkade', color: protocolColor('ARKADE') },
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
                            <AmountText style={styles.balanceAmount}>{primaryText}</AmountText>
                            {!!primaryUnitLabel && (
                                <Text style={styles.balanceCurrency}>{primaryUnitLabel}</Text>
                            )}
                        </View>
                        <AmountText style={styles.balanceUsd}>{secondaryText ?? ''}</AmountText>
                    </TouchableOpacity>
                ) : (
                    <>
                        <View style={styles.balanceRow}>
                            <AmountText style={styles.balanceAmount}>
                                {formatSatoshis(totalBalance)}
                            </AmountText>
                            <Text style={styles.balanceCurrency}>{bitcoinUnit}</Text>
                        </View>
                        <AmountText style={styles.balanceUsd}>
                            {formatUSD(totalBalance) !== '0.00' ? `$${formatUSD(totalBalance)} USD` : ''}
                        </AmountText>
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
                    color={theme.colors.text.secondary}
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
                                        <AmountText style={styles.breakdownValue}>
                                            {formatSatoshis(bal.total)} <Text style={styles.breakdownUnit}>{bitcoinUnit}</Text>
                                        </AmountText>
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
        paddingHorizontal: theme.spacing[4],
        paddingTop: theme.spacing[2],
        paddingBottom: theme.spacing[4],
    },
    totalBalanceContainer: {
        alignItems: 'center',
        marginBottom: theme.spacing[4],
    },
    balanceLabel: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        marginBottom: theme.spacing[1],
    },
    balanceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: theme.spacing[1],
    },
    balanceAmount: {
        fontSize: theme.typography.fontSize['4xl'],
        fontWeight: theme.typography.fontWeight.extrabold,
        color: theme.colors.text.primary,
        marginRight: theme.spacing[2],
    },
    balanceCurrency: {
        fontSize: theme.typography.fontSize.lg,
        fontWeight: theme.typography.fontWeight.medium,
        color: theme.colors.text.secondary,
    },
    balanceUsd: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.tertiary,
        minHeight: 18,
    },
    refreshButton: {
        position: 'absolute',
        top: theme.spacing[2],
        right: theme.spacing[4],
        width: 36,
        height: 36,
        borderRadius: theme.borderRadius.full,
        backgroundColor: 'rgba(255,255,255,0.12)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    balanceBreakdown: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: theme.borderRadius.md,
        paddingVertical: theme.spacing[3],
        paddingHorizontal: theme.spacing[2],
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
        marginRight: theme.spacing[2],
    },
    breakdownText: {
        justifyContent: 'center',
    },
    breakdownLabel: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.tertiary,
        marginBottom: 1,
    },
    breakdownValue: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.primary,
    },
    breakdownUnit: {
        fontSize: 10,
        fontWeight: theme.typography.fontWeight.normal,
        color: theme.colors.text.muted,
    },
    breakdownDivider: {
        width: 1,
        backgroundColor: 'rgba(255,255,255,0.12)',
        marginHorizontal: theme.spacing[1],
    },
});
