import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { theme, motion } from '../theme';
import { Card } from './Card';
import { AssetIcon } from './AssetIcon';
import { SectionHeader } from './SectionHeader';
import { AmountText } from './AmountText';
import { PressableScale } from './PressableScale';
import { feedback } from '../utils/feedback';
import { formatAssetAmount, getAssetBaseUnitBalance, type AssetBalanceLike } from '../utils/assetAmount';

interface NiaAsset {
    asset_id: string;
    ticker: string;
    name: string;
    precision: number;
    balance: AssetBalanceLike;
    protocol?: 'RGB' | 'SPARK' | 'ARKADE';
    icon?: string;
    /** Unit shown after the amount (e.g. "sats" for BTC). Defaults to the ticker. */
    unit?: string;
    /** USD value of the balance, when the asset has a known price. */
    fiatValue?: number;
}

interface AssetListProps {
    assets: NiaAsset[];
    onViewAll: () => void;
    onAssetPress: (asset: NiaAsset) => void;
    onIssueAsset: () => void;
}

const VISIBLE = 4;

const PROTOCOL_LABEL: Record<string, string> = { RGB: 'RGB', SPARK: 'Spark', ARKADE: 'Arkade' };

/** "21000" → "21,000", "1234.5678" → "1,234.5678": the integer part gets separators. */
function groupThousands(amount: string): string {
    const [int, frac] = amount.split('.');
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? `.${frac}` : '');
}

export function formatUsd(value: number): string {
    const abs = Math.abs(value);
    const digits = abs > 0 && abs < 0.01 ? 4 : 2;
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

/** One asset: what it is on the left, how much (and what it's worth) on the right. */
const AssetRow: React.FC<{ asset: NiaAsset; index: number; last: boolean; onPress: () => void }> = ({ asset, index, last, onPress }) => {
    const baseUnits = getAssetBaseUnitBalance(asset.balance);
    const amount = groupThousands(formatAssetAmount(baseUnits, asset.precision));
    const unit = asset.unit ?? asset.ticker;
    const empty = baseUnits <= 0;
    const subtitle = [asset.ticker !== asset.name ? asset.ticker : null, asset.protocol ? PROTOCOL_LABEL[asset.protocol] : null]
        .filter(Boolean).join(' · ');
    const fiat = asset.fiatValue !== undefined && asset.fiatValue > 0 ? formatUsd(asset.fiatValue) : null;

    return (
        <Animated.View entering={FadeInDown.delay(index * motion.stagger).duration(motion.duration.base)}>
            <PressableScale
                scaleTo={0.98}
                onPress={() => { feedback.select(); onPress(); }}
                accessibilityRole="button"
                accessibilityLabel={`${asset.name}, ${amount} ${unit}${fiat ? `, about ${fiat}` : ''}`}
                style={[styles.row, !last && styles.rowDivider]}
            >
                <AssetIcon ticker={asset.ticker} protocol={asset.protocol} logoUri={asset.icon} size={40} />
                <View style={styles.info}>
                    <Text style={styles.name} numberOfLines={1}>{asset.name}</Text>
                    {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
                </View>
                <View style={styles.amounts}>
                    <AmountText style={[styles.amount, empty && styles.amountEmpty]} numberOfLines={1}>
                        {amount} <Text style={styles.unit}>{unit}</Text>
                    </AmountText>
                    {fiat && <AmountText style={styles.fiat} numberOfLines={1}>≈ {fiat}</AmountText>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
            </PressableScale>
        </Animated.View>
    );
};

export const AssetList: React.FC<AssetListProps> = ({
    assets,
    onViewAll,
    onAssetPress,
}) => {
    const shown = assets.slice(0, VISIBLE);
    const more = assets.length - shown.length;
    return (
        <View style={styles.section}>
            <SectionHeader title="Assets" eyebrow actionLabel="View All" onAction={onViewAll} />

            {assets.length === 0 ? (
                <Card style={styles.emptyCard}>
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIcon}>
                            <Ionicons name="layers-outline" size={28} color={theme.colors.text.tertiary} />
                        </View>
                        <Text style={styles.emptyTitle}>No assets yet</Text>
                        <Text style={styles.emptyDescription}>
                            Your tokens and assets will appear here
                        </Text>
                    </View>
                </Card>
            ) : (
                <View style={styles.group}>
                    {shown.map((asset, i) => (
                        <AssetRow key={asset.asset_id} asset={asset} index={i} last={i === shown.length - 1 && more <= 0}
                            onPress={() => onAssetPress(asset)} />
                    ))}
                    {more > 0 && (
                        <PressableScale scaleTo={0.98} onPress={onViewAll} accessibilityRole="button"
                            accessibilityLabel={`View ${more} more ${more === 1 ? 'asset' : 'assets'}`} style={styles.moreRow}>
                            <Text style={styles.moreText}>View {more} more {more === 1 ? 'asset' : 'assets'}</Text>
                            <Ionicons name="chevron-forward" size={16} color={theme.colors.primary[500]} />
                        </PressableScale>
                    )}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    section: {
        marginTop: theme.spacing[6],
        paddingHorizontal: theme.spacing[4],
    },
    // All assets in one surface: rows separated by hairlines read as a single list.
    group: {
        borderRadius: theme.borderRadius.xl,
        backgroundColor: theme.colors.surface.primary,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.light,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[3],
        minHeight: 64,
        paddingVertical: theme.spacing[3],
        paddingHorizontal: theme.spacing[4],
    },
    rowDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.light,
    },
    info: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    name: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    subtitle: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.secondary,
    },
    amounts: {
        alignItems: 'flex-end',
        gap: 2,
        maxWidth: '48%',
    },
    amount: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    amountEmpty: {
        color: theme.colors.text.tertiary,
    },
    unit: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '500',
        color: theme.colors.text.secondary,
    },
    fiat: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.secondary,
    },
    moreRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing[1],
        minHeight: 48,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.light,
    },
    moreText: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.primary[500],
        fontWeight: '600',
    },
    emptyCard: {
        padding: theme.spacing[6],
        alignItems: 'center',
        backgroundColor: theme.colors.surface.secondary,
        borderWidth: 1,
        borderColor: theme.colors.border.light,
        shadowOpacity: 0,
    },
    emptyState: {
        alignItems: 'center',
    },
    emptyIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: theme.colors.background.secondary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing[3],
    },
    emptyTitle: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
        marginBottom: theme.spacing[1],
    },
    emptyDescription: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
});
