import { useAppTheme } from '../theme/ThemeProvider';
import { AllocationBar } from './AllocationBar';
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, protocolColor } from '../theme';
import { NetworkIcon } from './NetworkIcon';
import { Skeleton } from './Skeleton';
import { AmountText } from './AmountText';
import { formatUsd, type BreakdownAssetRow } from '../utils/portfolio';

interface ProtocolBalance {
    confirmed: number;
    unconfirmed: number;
    total: number;
}

interface BalanceCardProps {
    totalBalance: number;
    holdingBalance?: boolean;
    hideAmounts?: boolean;
    pendingBtc?: number;
    availableBtc?: number;
    stale?: boolean;
    lastUpdatedAt?: number;
    /** Sats on test networks: no value, never part of the total. */
    testBtc?: number;
    /** Accounts on a test network, with the network's name. */
    testNetworks?: Partial<Record<'RGB' | 'SPARK' | 'ARKADE' | 'BARK', string>>;
    /** Other assets, listed under the bitcoin rows (see breakdownAssetRows). */
    assetRows?: BreakdownAssetRow[];
    /** Showing the last known balance while the live one loads. */
    updating?: boolean;
    pendingAccounts?: string[];
    rgbBalanceIsLightning?: boolean;
    /** A Lightning node is connected, so its channel balance has a row. */
    showLightning?: boolean;
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
        BARK?: ProtocolBalance;
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


const CONTROL_HIT_SLOP = { top: 7, bottom: 7, left: 7, right: 7 };

const PROTOCOL_DISPLAY: Array<{ key: string; label: string; color: string }> = [
    { key: 'RGB', label: 'Lightning', color: protocolColor('RGB') },
    { key: 'SPARK', label: 'Spark', color: protocolColor('SPARK') },
    { key: 'ARKADE', label: 'Arkade', color: protocolColor('ARKADE') },
    { key: 'BARK', label: 'Bark', color: protocolColor('BARK') },
];

export const BalanceCard: React.FC<BalanceCardProps> = ({
    totalBalance,
    hideAmounts = false,
    pendingBtc = 0,
    availableBtc,
    stale = false,
    lastUpdatedAt,
    testBtc = 0,
    testNetworks = {},
    assetRows = [],
    holdingBalance = false,
    updating = false,
    pendingAccounts = [],
    rgbBalanceIsLightning = false,
    showLightning = true,
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
    const theme = useAppTheme();
    const styles = makeStyles(theme);
    const [slow, setSlow] = useState(false);
    const syncing = !!(updating || loading || pendingAccounts.length);
    useEffect(() => {
        setSlow(false);
        if (!syncing) return;
        const timer = setTimeout(() => setSlow(true), 12_000);
        return () => clearTimeout(timer);
    }, [syncing]);
    const amountOpacity = useRef(new Animated.Value(1)).current;
    const previousAmount = useRef(primaryText);
    const [reduceMotion, setReduceMotion] = useState(true);
    useEffect(() => {
        let active = true;
        void AccessibilityInfo?.isReduceMotionEnabled?.().then(value => { if (active) setReduceMotion(value); });
        const listener = AccessibilityInfo?.addEventListener?.('reduceMotionChanged', setReduceMotion);
        return () => { active = false; listener?.remove(); };
    }, []);
    useEffect(() => {
        if (previousAmount.current === primaryText) return;
        previousAmount.current = primaryText;
        if (reduceMotion) { amountOpacity.setValue(1); return; }
        amountOpacity.setValue(0.65);
        const animation = Animated.timing(amountOpacity, { toValue: 1, duration: 180, useNativeDriver: true });
        animation.start();
        return () => animation.stop?.();
    }, [primaryText, reduceMotion, amountOpacity]);
    const useDenominated = primaryText !== undefined;
    // Filter to only protocols with balance data
    const activeProtocols = byProtocol
        ? PROTOCOL_DISPLAY.filter(p => byProtocol[p.key as keyof typeof byProtocol])
        : [];
    const hasBreakdown = activeProtocols.length > 0 || assetRows.length > 0 || availableBtc !== undefined || !!lastUpdatedAt
        || pendingBtc > 0 || testBtc > 0 || stale;
    // Per-network balances are collapsed behind a chevron (extension parity).
    const [showBreakdown, setShowBreakdown] = useState(false);
    // The on-chain row belongs to the RGB node's wallet.
    const testOf = (key: string) => testNetworks[(key === 'BITCOIN' ? 'RGB' : key) as keyof typeof testNetworks];

    // Show on-chain funds only when the adapter reports them; the protocol legs
    // (RLN / Spark / Arkade) appear only when that key exists in `byProtocol`,
    // mirroring the `activeProtocols` presence logic as individual rows.
    const breakdownRows: Array<{
        key: 'BITCOIN' | 'RGB' | 'SPARK' | 'ARKADE' | 'BARK';
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
    if (byProtocol && 'RGB' in byProtocol && (rgbBalanceIsLightning || showLightning)) {
        breakdownRows.push({
            key: 'RGB',
            name: 'BTC on Lightning',
            subtitle: 'RGB Lightning node',
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
            subtitle: (byProtocol?.ARKADE?.unconfirmed ?? 0) > 0 && !hideAmounts
                ? `Available · ${formatSatoshis(byProtocol.ARKADE!.unconfirmed)} ${bitcoinUnit} unavailable` : 'Available on Arkade',
            accent: protocolColor('ARKADE'),
            value: byProtocol?.ARKADE?.confirmed ?? 0,
        });
    }
    if (byProtocol && 'BARK' in byProtocol) {
        breakdownRows.push({
            key: 'BARK',
            name: 'BTC on Bark',
            // Pending covers rounds, boarding and in-flight Lightning (old Bark screen).
            subtitle: (byProtocol?.BARK?.unconfirmed ?? 0) > 0 && !hideAmounts
                ? `Bark balance · ${formatSatoshis(byProtocol.BARK!.unconfirmed)} ${bitcoinUnit} pending`
                : 'Bark balance',
            accent: protocolColor('BARK'),
            value: byProtocol?.BARK?.total ?? 0,
        });
    }

    return (
        <View style={styles.container}>
            {/* No label or status words above the figure: the refresh button turns
                into the one updating indicator, and the details sit behind the chevron. */}
            <View style={styles.cardHeader}>
                {/* Refresh and balance details stay separate from denomination. */}
                <View style={styles.topControls}>
                    <TouchableOpacity
                        style={styles.controlButton}
                        accessibilityRole="button"
                        onPress={onRefresh}
                        disabled={refreshing || syncing}
                        accessibilityLabel="Refresh balance"
                        accessibilityState={{ disabled: refreshing || syncing }}
                        hitSlop={CONTROL_HIT_SLOP}
                    >
                        {syncing
                            ? <ActivityIndicator size="small" accessibilityLabel="Updating balance" color={theme.colors.text.secondary} style={styles.controlSpinner} />
                            : <Ionicons name="refresh" size={14} color={refreshing ? theme.colors.text.tertiary : theme.colors.text.secondary} />}
                    </TouchableOpacity>
                    {hasBreakdown && (
                        <TouchableOpacity
                            style={styles.controlButton}
                            accessibilityRole="button"
                            onPress={() => setShowBreakdown(v => !v)}
                            accessibilityState={{ expanded: showBreakdown }}
                            accessibilityLabel={showBreakdown ? 'Hide network balances' : 'Show network balances'}
                            hitSlop={CONTROL_HIT_SLOP}
                        >
                            <Ionicons
                                name={showBreakdown ? 'chevron-up' : 'chevron-down'}
                                size={14}
                                color={theme.colors.text.secondary}
                            />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
            <Animated.View style={[styles.totalBalanceContainer, { opacity: amountOpacity }]}>
                {loading ? (
                    <View style={{ gap: 10, marginTop: 4 }}>
                        <Skeleton width={180} height={34} radius={10} style={{ backgroundColor: 'rgba(255,255,255,0.18)' }} />
                        <Skeleton width={110} height={15} radius={7} style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    </View>
                ) : useDenominated ? (
                    <>
                        {/* Tap the amount to cycle sats / BTC / fiat. The unit sits inline
                            next to the figure; no separate picker row below it. */}
                        <TouchableOpacity style={styles.primaryBalance} onPress={onCycleDenomination} disabled={!onCycleDenomination}
                            accessibilityRole="button"
                            accessibilityLabel={`${holdingBalance ? 'Last balance' : syncing ? 'Balance so far' : 'Total balance'} ${primaryText} ${primaryUnitLabel ?? ''}.${onCycleDenomination ? ' Tap to change unit.' : ''}`}>
                            <View style={styles.balanceRow}>
                                <AmountText style={styles.balanceAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>{primaryText}</AmountText>
                                {/* Fiat figures already carry their symbol, so only sats/BTC get a unit label. */}
                                {!hideAmounts && (primaryUnitLabel === 'sats' || primaryUnitLabel === 'BTC') && (
                                    <Text style={styles.balanceCurrency}>{primaryUnitLabel}</Text>
                                )}
                            </View>
                        </TouchableOpacity>
                        {!!secondaryText && <AmountText style={styles.balanceUsd}>{secondaryText}</AmountText>}
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
                {/* Only the figure (and its equivalent) under the balance; status, pending and
                    test funds are in the details. Slow accounts are named there. */}
                {showBreakdown && syncing && slow && <Text accessibilityLiveRegion="polite" style={styles.subLine}>
                    Still syncing{pendingAccounts.length ? ` · ${pendingAccounts.join(', ')}` : ''}
                </Text>}
                {!loading && showBreakdown && (availableBtc !== undefined || pendingBtc > 0) && (
                    <View style={{ gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
                        {availableBtc !== undefined && <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing[3] }}>
                            <Text style={styles.subLine}>{stale || updating ? 'Last known available BTC' : 'Available bitcoin'}</Text>
                            <AmountText style={[styles.subLine, { color: theme.colors.text.primary, fontWeight: '600' }]}>{hideAmounts ? '••••' : `${formatSatoshis(availableBtc)} ${bitcoinUnit}`}</AmountText>
                        </View>}
                        {pendingBtc > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing[3] }}>
                            <Text style={styles.subLine}>Not yet available</Text>
                            <AmountText style={[styles.subLine, { color: theme.colors.text.primary, fontWeight: '600' }]}>{hideAmounts ? '••••' : `${formatSatoshis(pendingBtc)} ${bitcoinUnit}`}</AmountText>
                        </View>}
                        {pendingBtc > 0 && <Text style={styles.subLine}>Awaiting confirmation or temporarily unavailable in an account.</Text>}
                    </View>
                )}
                {showBreakdown && !loading && !syncing && (stale || lastUpdatedAt) && <Text accessibilityLiveRegion="polite" style={[styles.subLine, stale && { color: theme.colors.warning[500] }]}>
                    {stale ? 'Balance may be incomplete' : 'Updated'}{lastUpdatedAt ? ` · ${new Date(lastUpdatedAt).toLocaleString()}` : ''}
                </Text>}
                {showBreakdown && !loading && testBtc > 0 && (
                    <Text style={styles.subLine}>
                        Test funds · {hideAmounts ? '••••' : `${formatSatoshis(testBtc)} ${bitcoinUnit}`} · no real value
                    </Text>
                )}
            </Animated.View>

            {/* Per-network breakdown — vertical row list, collapsed behind the
                chevron above. Mirrors the extension's BITCOIN section. */}
            {hasBreakdown && showBreakdown && (
                <View style={styles.breakdownSection}>
                    <View style={styles.breakdownHairline} />
                    {breakdownRows.length > 0 && <Text style={styles.breakdownEyebrow}>Bitcoin</Text>}
                    <AllocationBar hideAmounts={hideAmounts} items={breakdownRows.filter(row => !testOf(row.key)).map(row => ({ label: row.name, value: row.value, color: row.accent }))} />
                    <View style={styles.breakdownList}>
                        {breakdownRows.map((row) => (
                            <View
                                key={row.key}
                                style={[styles.networkRow, row.value === 0 && styles.networkRowDimmed]}
                            >
                                <View style={[styles.networkAccentBar, { backgroundColor: row.accent }]} />
                                <View style={[styles.networkIconChip, { backgroundColor: row.accent + '22' }]}>
                                    <NetworkIcon network={row.key === 'BITCOIN' ? 'onchain' : row.key === 'RGB' ? 'rln' : row.key} size={16} />
                                </View>
                                <View style={styles.networkTextBlock}>
                                    <Text style={styles.networkName}>{row.name}</Text>
                                    <Text style={styles.networkSubtitle}>
                                        {testOf(row.key) ? `${testOf(row.key)} · Test network` : row.subtitle}
                                    </Text>
                                </View>
                                <View style={styles.networkValueBlock}>
                                    <AmountText style={styles.networkValueFiat}>
                                        {hideAmounts ? '••••' : `${formatSatoshis(row.value)} ${bitcoinUnit}`}
                                    </AmountText>
                                    <AmountText style={styles.networkValueSats}>
                                        {hideAmounts ? '••••' : testOf(row.key) ? 'Test' : `$${formatUSD(row.value)}`}
                                    </AmountText>
                                </View>
                            </View>
                        ))}
                    </View>
                    {/* Other assets (extension parity): priced ones count in the
                        total at their dollar value; unpriced ones show no fiat. */}
                    {assetRows.length > 0 && (
                        <>
                            <Text style={[styles.breakdownEyebrow, breakdownRows.length > 0 && styles.breakdownEyebrowSpaced]}>Assets</Text>
                            <View style={styles.breakdownList}>
                                {assetRows.map((row) => {
                                    const accent = protocolColor(row.network.toUpperCase());
                                    return (
                                        <View key={row.key} style={styles.networkRow} accessibilityLabel={hideAmounts
                                            ? `${row.ticker} on ${row.networkLabel}`
                                            : `${row.amount} ${row.ticker} on ${row.networkLabel}${row.usdValue !== undefined ? `, about ${formatUsd(row.usdValue)}` : ''}`}>
                                            <View style={[styles.networkAccentBar, { backgroundColor: accent }]} />
                                            <View style={[styles.networkIconChip, { backgroundColor: accent + '22' }]}>
                                                <NetworkIcon network={row.network} size={16} />
                                            </View>
                                            <View style={styles.networkTextBlock}>
                                                <Text style={styles.networkName} numberOfLines={1}>{row.ticker}</Text>
                                                <Text style={styles.networkSubtitle} numberOfLines={1}>
                                                    {`${row.name} · ${row.networkLabel}`}
                                                </Text>
                                            </View>
                                            <View style={styles.networkValueBlock}>
                                                {row.usdValue !== undefined && (
                                                    <AmountText style={styles.networkValueFiat}>
                                                        {hideAmounts ? '••••' : `≈ ${formatUsd(row.usdValue)}`}
                                                    </AmountText>
                                                )}
                                                <AmountText style={row.usdValue !== undefined ? styles.networkValueSats : styles.networkValueFiat}>
                                                    {hideAmounts ? '••••' : `${row.amount} ${row.ticker}`}
                                                </AmountText>
                                            </View>
                                        </View>
                                    );
                                })}
                            </View>
                        </>
                    )}
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

const makeStyles = (theme: typeof import('../theme').theme) => StyleSheet.create({
    container: {
        // Distinct rounded card surface, matching the extension's TOTAL BALANCE
        // card (#0F1C33, 16px radius, hairline border on the navy background).
        backgroundColor: theme.colors.surface.primary,
        borderRadius: 16,
        paddingHorizontal: theme.spacing[4],
        paddingVertical: theme.spacing[3],
    },
    cardHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: theme.spacing[3],
    },
    totalBalanceContainer: {
        alignItems: 'center', paddingTop: theme.spacing[1], paddingBottom: theme.spacing[2],
    },
    primaryBalance: { width: '100%', alignItems: 'center' },
    subLine: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.secondary,
        marginTop: theme.spacing[1],
    },
    balanceRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'center',
        gap: theme.spacing[1.5],
    },
    balanceAmount: {
        // Large display headline, black (900 — Satoshi Black face via the global
        // text patch), tight tracking — matches the extension's prominent
        // TOTAL BALANCE figure.
        fontSize: 36,
        fontWeight: '900',
        letterSpacing: -0.7,
        color: theme.colors.text.primary,
        textAlign: 'center',
    },
    balanceCurrency: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: theme.typography.fontWeight.medium,
        color: theme.colors.text.secondary,
    },
    balanceUsd: {
        // Equivalent balance (e.g. "0.00003652 BTC") — monospaced like the extension.
        fontFamily: theme.typography.fontFamily.mono,
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.tertiary,
        marginTop: theme.spacing[0.5],
    },
    topControls: {
        flexDirection: 'row',
        gap: theme.spacing[2],
    },
    // Small icon buttons; hitSlop keeps the touch target at 44pt.
    controlButton: {
        width: 30,
        height: 30,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.surface.secondary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    controlSpinner: { transform: [{ scale: 0.75 }] },
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
    breakdownEyebrowSpaced: {
        marginTop: theme.spacing[3],
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
        opacity: 0.75,
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
        marginTop: theme.spacing[1],
        marginBottom: theme.spacing[3],
        marginHorizontal: theme.spacing[1],
    },
});
