import React, { useState } from 'react';
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
    hideAmounts?: boolean;
    pendingBtc?: number;
    includesTokenValue?: boolean;
    rgbBalanceIsLightning?: boolean;
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
    /**
     * Rendered inside the card, below the balance/breakdown and separated by an
     * inset divider line. Used to host the action buttons (Receive/Swap/Send) so
     * the whole wallet header reads as one unified card (extension parity).
     */
    footer?: React.ReactNode;
}

const PROTOCOL_DISPLAY: Array<{ key: string; label: string; color: string }> = [
    { key: 'RGB', label: 'RLN', color: protocolColor('RGB') },
    { key: 'SPARK', label: 'Spark', color: protocolColor('SPARK') },
    { key: 'ARKADE', label: 'Arkade', color: protocolColor('ARKADE') },
];

export const BalanceCard: React.FC<BalanceCardProps> = ({
    totalBalance,
    hideAmounts = false,
    pendingBtc = 0,
    includesTokenValue = false,
    rgbBalanceIsLightning = false,
    bitcoinUnit,
    onRefresh,
    refreshing,
    formatSatoshis,
    formatUSD,
    lightningBalance,
    byProtocol,
    loading,
    primaryText,
    primaryUnitLabel,
    secondaryText,
    onCycleDenomination,
    footer,
}) => {
    const useDenominated = primaryText !== undefined;
    // Filter to only protocols with balance data
    const activeProtocols = byProtocol
        ? PROTOCOL_DISPLAY.filter(p => byProtocol[p.key as keyof typeof byProtocol])
        : [];
    // Per-network balances are collapsed behind a chevron (extension parity).
    const [showBreakdown, setShowBreakdown] = useState(false);

    // Show on-chain funds only when the adapter reports them; the protocol legs
    // (RLN / Spark / Arkade) appear only when that key exists in `byProtocol`,
    // mirroring the `activeProtocols` presence logic as individual rows.
    const breakdownRows: Array<{
        key: 'BITCOIN' | 'RGB' | 'SPARK' | 'ARKADE';
        name: string;
        subtitle: string;
        accent: string;
        value: number;
    }> = rgbBalanceIsLightning || !byProtocol?.RGB ? [] : [
        {
            key: 'BITCOIN',
            name: 'BTC on-chain',
            subtitle: 'Standard Bitcoin balance',
            accent: theme.colors.networks.bitcoin,
            // On-chain = the RGB/RLN node's L1 balance (mirrors the extension's
            // `btcOnchain = onchainData.confirmedSat`). `onChainBalance` is the
            // aggregate spendable total, so it can't be used for this row.
            value: byProtocol?.RGB?.confirmed ?? 0,
        },
    ];
    if (byProtocol && 'RGB' in byProtocol) {
        breakdownRows.push({
            key: 'RGB',
            name: 'BTC on RLN',
            subtitle: 'RLN balance',
            accent: protocolColor('RGB'),
            // RLN = Lightning channel balance (extension's `btcLightning`).
            value: rgbBalanceIsLightning ? (byProtocol.RGB?.total ?? 0) : lightningBalance,
        });
    }
    if (byProtocol && 'SPARK' in byProtocol) {
        breakdownRows.push({
            key: 'SPARK',
            name: 'BTC on Spark',
            subtitle: 'Spark balance',
            accent: protocolColor('SPARK'),
            value: byProtocol?.SPARK?.total ?? 0,
        });
    }
    if (byProtocol && 'ARKADE' in byProtocol) {
        breakdownRows.push({
            key: 'ARKADE',
            name: 'BTC on Arkade',
            subtitle: 'Arkade balance',
            accent: protocolColor('ARKADE'),
            value: byProtocol?.ARKADE?.total ?? 0,
        });
    }

    return (
        <View style={styles.container}>
            <View style={styles.cardHeader}>
                <Text style={styles.balanceLabel}>{includesTokenValue ? 'Total estimated value' : 'Total balance'}</Text>
                {/* Refresh and balance details stay separate from denomination. */}
                <View style={styles.topControls}>
                    <TouchableOpacity
                        style={styles.controlButton}
                        onPress={onRefresh}
                        disabled={refreshing}
                        accessibilityLabel="Refresh balance"
                    >
                        <Ionicons
                            name="refresh"
                            size={16}
                            color={theme.colors.text.secondary}
                            style={refreshing ? { transform: [{ rotate: '180deg' }] } : {}}
                        />
                    </TouchableOpacity>
                    {activeProtocols.length > 0 && (
                        <TouchableOpacity
                            style={styles.controlButton}
                            onPress={() => setShowBreakdown(v => !v)}
                            accessibilityLabel={showBreakdown ? 'Hide network balances' : 'Show network balances'}
                        >
                            <Ionicons
                                name={showBreakdown ? 'chevron-up' : 'chevron-down'}
                                size={16}
                                color={theme.colors.text.secondary}
                            />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
            <View style={styles.totalBalanceContainer}>
                {loading ? (
                    <View style={{ gap: 10, marginTop: 4 }}>
                        <Skeleton width={180} height={34} radius={10} style={{ backgroundColor: 'rgba(255,255,255,0.18)' }} />
                        <Skeleton width={110} height={15} radius={7} style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    </View>
                ) : useDenominated ? (
                    <>
                        <TouchableOpacity style={styles.primaryBalance} onPress={onCycleDenomination} disabled={!onCycleDenomination}
                            accessibilityRole="button"
                            accessibilityLabel={`Total balance ${primaryText} ${primaryUnitLabel ?? ''}. Tap to change denomination.`}>
                            <AmountText style={styles.balanceAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>{primaryText}</AmountText>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.unitChip} onPress={onCycleDenomination} disabled={!onCycleDenomination}
                            accessibilityRole="button" accessibilityLabel={`Change balance unit. Current unit: ${primaryUnitLabel || bitcoinUnit}`}>
                            <Text style={styles.balanceCurrency}>{primaryUnitLabel || bitcoinUnit}</Text>
                            {!!onCycleDenomination && <Ionicons name="chevron-down" size={14} color={theme.colors.text.secondary} />}
                        </TouchableOpacity>
                        <AmountText style={styles.balanceUsd}>{secondaryText ?? ''}</AmountText>
                    </>
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

            {/* Per-network breakdown — vertical row list, collapsed behind the
                chevron above. Mirrors the extension's BITCOIN section. */}
            {activeProtocols.length > 0 && showBreakdown && (
                <View style={styles.breakdownSection}>
                    <View style={styles.breakdownHairline} />
                    <Text style={styles.breakdownEyebrow}>Bitcoin</Text>
                    {pendingBtc > 0 && <Text style={styles.pendingBalance}>Pending: {hideAmounts ? '••••' : `${formatSatoshis(pendingBtc)} ${bitcoinUnit}`}</Text>}
                    <View style={styles.breakdownList}>
                        {breakdownRows.map((row) => (
                            <View
                                key={row.key}
                                style={[styles.networkRow, row.value === 0 && styles.networkRowDimmed]}
                            >
                                <View style={[styles.networkAccentBar, { backgroundColor: row.accent }]} />
                                <View style={[styles.networkIconChip, { backgroundColor: row.accent + '22' }]}>
                                    {row.key === 'BITCOIN' ? (
                                        <Ionicons name="link" size={15} color={row.accent} />
                                    ) : row.key === 'RGB' ? (
                                        <Ionicons name="flash" size={15} color={row.accent} />
                                    ) : (
                                        <NetworkIcon network={row.key} size={15} color={row.accent} />
                                    )}
                                </View>
                                <View style={styles.networkTextBlock}>
                                    <Text style={styles.networkName}>{row.name}</Text>
                                    <Text style={styles.networkSubtitle}>{row.subtitle}</Text>
                                </View>
                                <View style={styles.networkValueBlock}>
                                    <AmountText style={styles.networkValueFiat}>
                                        {hideAmounts ? '••••' : `$${formatUSD(row.value)}`}
                                    </AmountText>
                                    <AmountText style={styles.networkValueSats}>
                                        {hideAmounts ? '••••' : `${formatSatoshis(row.value)} ${bitcoinUnit}`}
                                    </AmountText>
                                </View>
                            </View>
                        ))}
                    </View>
                </View>
            )}

            {/* Inset divider + footer (action buttons) — turns the balance + actions
                into a single unified card, matching the extension. The divider sits
                within the card's padding so it stops short of the card edges. */}
            {footer !== undefined && footer !== null && (
                <>
                    <View style={styles.footerDivider} />
                    {footer}
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        // Distinct rounded card surface, matching the extension's TOTAL BALANCE
        // card (#0F1C33, 16px radius, hairline border on the navy background).
        backgroundColor: theme.colors.surface.primary,
        borderRadius: 16,
        padding: theme.spacing[4],
    },
    cardHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing[3],
    },
    totalBalanceContainer: {
        alignItems: 'center', paddingTop: theme.spacing[3], paddingBottom: theme.spacing[4],
    },
    primaryBalance: { width: '100%', alignItems: 'center' },
    balanceLabel: {
        flex: 1, fontSize: theme.typography.fontSize.xs,
        fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text.secondary,
    },
    unitChip: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1], minHeight: 44,
        paddingHorizontal: theme.spacing[3], borderRadius: theme.borderRadius.full,
    },
    pendingBalance: { color: theme.colors.text.secondary, marginBottom: theme.spacing[3] },
    balanceRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'center',
        marginBottom: theme.spacing[1],
    },
    balanceAmount: {
        // Large display headline, black (900 — Satoshi Black face via the global
        // text patch), tight tracking — matches the extension's prominent
        // TOTAL BALANCE figure.
        fontSize: 44,
        fontWeight: '900',
        letterSpacing: -0.9,
        color: theme.colors.text.primary,
        textAlign: 'center',
    },
    balanceCurrency: {
        fontSize: theme.typography.fontSize.lg,
        fontWeight: theme.typography.fontWeight.medium,
        color: theme.colors.text.secondary,
    },
    balanceUsd: {
        // Equivalent balance (e.g. "0.00003652 BTC") — monospaced like the extension.
        fontFamily: theme.typography.fontFamily.mono,
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.tertiary,
        minHeight: 18,
    },
    topControls: {
        flexDirection: 'row',
        gap: theme.spacing[2],
    },
    controlButton: {
        width: 44,
        height: 44,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.surface.secondary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    breakdownSection: {
        marginTop: theme.spacing[3],
    },
    breakdownHairline: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border.medium,
        marginBottom: theme.spacing[3],
    },
    breakdownEyebrow: {
        fontSize: theme.typography.fontSize.xs,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: theme.colors.text.muted,
        marginBottom: theme.spacing[2],
    },
    breakdownList: {
        gap: theme.spacing[1.5],
    },
    networkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: theme.spacing[2],
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.surface.secondary,
    },
    networkRowDimmed: {
        opacity: 0.45,
    },
    networkAccentBar: {
        width: 3,
        alignSelf: 'stretch',
        borderRadius: 2,
        marginRight: theme.spacing[3],
    },
    networkIconChip: {
        width: 28,
        height: 28,
        borderRadius: theme.borderRadius.md,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing[3],
    },
    networkTextBlock: {
        flex: 1,
    },
    networkName: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.primary,
    },
    networkSubtitle: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.muted,
    },
    networkValueBlock: {
        alignItems: 'flex-end',
        marginLeft: theme.spacing[2],
    },
    networkValueFiat: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.primary,
    },
    networkValueSats: {
        fontFamily: theme.typography.fontFamily.mono,
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.muted,
    },
    footerDivider: {
        // Hairline separator between the balance block and the footer (action
        // buttons). Lives inside the card's padding so it stops short of the
        // card edges, leaving a little breathing room before the borders.
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border.medium,
        marginVertical: theme.spacing[3],
        marginHorizontal: theme.spacing[1],
    },
});
