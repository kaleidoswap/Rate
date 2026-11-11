// components/RecentActivityWidget.tsx
//
// An activity list for one place in the app: an asset's history on its detail
// screen (`assetId`), or the latest items with pending payments first.
// Tapping a row opens the ActivityDetailSheet inline.
import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    type StyleProp,
    type ViewStyle,
    TouchableOpacity,
} from 'react-native';
import { useAppSelector } from '../store/hooks';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import { theme } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';
import { SectionHeader } from './SectionHeader';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { ActivityDetailSheet } from './ActivityDetailSheet';
import {
    type ActivityItem,
    type ActivityItemType,
    type AssetMeta,
} from '../services/ActivityService';
import { loadSwapAttemptActivity, PAYMENT_ATTEMPT_KIND } from '../services/kaleidoPay/activity';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { ACTIVITY_STATUS_VISUAL } from '../utils/paymentStatus';
import { activityAmountIsIncoming, activityAmountPrefix, activityIcon, activityShortTime, activityTypeLabel, activityToneColor } from '../utils/activity-presentation';
import { useFiatRates } from '../hooks/useFiatRates';
import { formatSatoshisToUSD } from '../utils/bitcoinUnits';

interface Props {
    onViewAll?: () => void;
    /** The dashboard's empty state action: receiving is the natural next step. */
    emptyAction?: { label: string; onPress: () => void };
    onOpenPaymentAttempt?: (id: string) => void;
    /** Only this asset's items (an asset id, or 'BTC'), newest first. */
    assetId?: string;
    /** Swaps name the asset by ticker; matched too. */
    assetTicker?: string;
    title?: string;
    limit?: number;
    style?: StyleProp<ViewStyle>;
    /** Changing it loads the list again (e.g. an RGB transfer moved). */
    refreshKey?: number;
}

// Type names, icons, signs and compact ages come from utils/activity-presentation,
// shared with the Activity rows and the detail sheet so one payment reads the
// same wherever it appears.


const MAX_ITEMS = 4;

export const RecentActivityWidget: React.FC<Props> = ({ onViewAll, onOpenPaymentAttempt, assetId, assetTicker, title = 'Activity', limit, style, refreshKey, emptyAction }) => {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const usdRate = useFiatRates().usd;
    const swapHistory = useAppSelector((state: RootState) => state.swap.swapHistory);
    const rgbAssets = useAppSelector((state: RootState) => state.assets.rgbAssets);
    const walletId = useAppSelector((state: RootState) => state.wallet.activeWallet?.id);

    const [selected, setSelected] = useState<ActivityItem | null>(null);

    const feedOptions = useMemo(() => ({
        assets: (rgbAssets || []).map((a: any): AssetMeta => ({
            asset_id: a.asset_id,
            ticker: a.ticker,
            name: a.name,
            precision: a.precision ?? 0,
            protocol: a.protocol,
        })),
        swaps: (swapHistory || []).map((s: any) => ({
            rfq_id: s.rfq_id,
            status: s.status,
            created_at: s.created_at,
            txid: s.txid,
            from_asset: s.from_asset,
            to_asset: s.to_asset,
            from_amount: s.from_amount,
            to_amount: s.to_amount,
            venue: s.venue,
        })),
        loadSwapAttempts: () => loadSwapAttemptActivity(),
        walletId,
    }), [rgbAssets, swapHistory, walletId]);
    // Refreshes when the screen regains focus.
    const feed = useActivityFeed(feedOptions);
    const { refresh } = feed;
    useEffect(() => { if (refreshKey) void refresh(); }, [refreshKey, refresh]);

    const items = useMemo(() => {
        const list = assetId
            ? feed.items.filter(item => item.asset === assetId || (!!assetTicker && item.type === 'swap' && item.asset === assetTicker))
            : [...feed.items].sort((a, b) => Number(['pending', 'unknown'].includes(b.status)) - Number(['pending', 'unknown'].includes(a.status)));
        return list.slice(0, limit ?? (assetId ? 25 : MAX_ITEMS));
    }, [feed.items, assetId, assetTicker, limit]);
    const loading = feed.updating && items.length === 0;

    // A wallet with no activity yet keeps its place on the dashboard: the empty
    // state points at receiving instead of leaving a hole (asset pages say so
    // in their own words).
    const showEmptyState = !loading && items.length === 0 && !assetId;

    const renderRow = (item: ActivityItem) => {
        const v = activityIcon(item.type);
        const vColor = activityToneColor(v.tone, theme);
        const st = ACTIVITY_STATUS_VISUAL[item.status];
        const hasAmount = item.amount !== '';
        const label = activityTypeLabel(item);
        const fiat = hasAmount && item.rawSats != null && usdRate ? `≈ $${formatSatoshisToUSD(item.rawSats, usdRate)}` : '';

        return (
            <TouchableOpacity
                key={item.id}
                activeOpacity={0.7}
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={`${label}${item.contactName ? ` · ${item.contactName}` : ''}, ${item.amount} ${item.assetTicker}${fiat ? `, ${fiat}` : ''}, ${st.label}. Open details`}
                onPress={() => item.kind === PAYMENT_ATTEMPT_KIND && onOpenPaymentAttempt ? onOpenPaymentAttempt(item.id.replace('payment-attempt-', '')) : setSelected(item)}
            >
                <View style={[styles.iconWrap, { backgroundColor: vColor + '1A' }]}>
                    <Ionicons name={v.icon} size={18} color={vColor} />
                </View>

                <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{item.contactName ? `${label} · ${item.contactName}` : label}</Text>
                    <View style={styles.rowMeta}>
                        {item.timestamp != null && <Text style={styles.rowSubtitle}>{activityShortTime(item.timestamp)}</Text>}
                        <View style={[styles.statusDot, { backgroundColor: st.color }]} />
                        <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                </View>

                {hasAmount && (
                    <View style={styles.amountColumn}>
                        <Text
                            style={[
                                styles.rowAmount,
                                { color: activityAmountIsIncoming(item.type) ? theme.colors.tx.receive : theme.colors.text.primary },
                            ]}
                            numberOfLines={1}
                        >
                            {item.status === 'failed' ? '' : activityAmountPrefix(item.type)}{item.amount} {item.assetTicker}
                        </Text>
                        {!!fiat && <Text style={styles.fiatText} numberOfLines={1}>{fiat}</Text>}
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    return (
        <View style={[styles.container, style]}>
            <SectionHeader
                title={title}
                eyebrow
                actionLabel={onViewAll ? 'View All' : undefined}
                onAction={onViewAll}
                style={styles.sectionHeader}
            />

            {loading ? (
                <View style={styles.list}>
                    {[0, 1, 2].map(i => (
                        <View key={i} style={styles.row}>
                            <Skeleton width={36} height={36} radius={18} />
                            <View style={[styles.rowBody, { gap: theme.spacing[1] }]}>
                                <Skeleton width="55%" height={12} />
                                <Skeleton width="35%" height={10} />
                            </View>
                            <Skeleton width={64} height={14} />
                        </View>
                    ))}
                </View>
            ) : showEmptyState ? (
                <EmptyState
                    icon="arrow-down"
                    title="No payments yet"
                    message="Receive your first payment and it will show up here."
                    actionLabel={emptyAction ? emptyAction.label : undefined}
                    onAction={emptyAction?.onPress}
                />
            ) : items.length === 0 ? (
                <Text style={styles.empty}>No activity for this asset yet.</Text>
            ) : (
                <View style={styles.list}>{items.map(renderRow)}</View>
            )}

            <ActivityDetailSheet onRefresh={feed.refresh} item={items.find(item => item.id === selected?.id) ?? selected} onClose={() => setSelected(null)} />
        </View>
    );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    container: {
        marginTop: theme.spacing[6],
        paddingHorizontal: theme.spacing[4],
    },
    sectionHeader: {
        marginBottom: theme.spacing[3],
    },
    list: {
        gap: theme.spacing[3],
    },
    empty: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        paddingVertical: theme.spacing[4],
    },
    // Holds every item past the first; the gradient overlay fades them out.
    restWrap: {
        position: 'relative',
        marginTop: theme.spacing[3],
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing[3],
    },
    iconWrap: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: theme.spacing[3],
        flexShrink: 0,
    },
    rowBody: {
        flex: 1,
        gap: 4,
    },
    rowTitle: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    rowSubtitle: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.secondary,
    },
    rowMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
    },
    layerChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: theme.spacing[2],
        paddingVertical: 1,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.surface.tertiary,
    },
    statusDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    statusText: {
        fontSize: theme.typography.fontSize.xs,
        fontWeight: '600',
    },
    rowAmount: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '700',
        flexShrink: 1,
        marginLeft: theme.spacing[2],
        textAlign: 'right',
    },
    amountColumn: {
        alignItems: 'flex-end',
        gap: 1,
        flexShrink: 1,
    },
    fiatText: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.tertiary,
        textAlign: 'right',
    },
});

export default RecentActivityWidget;
