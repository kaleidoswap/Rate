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
    ActivityIndicator,
} from 'react-native';
import { useAppSelector } from '../store/hooks';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import { theme } from '../theme';
import { LAYER_LABEL, layerNetworkIcon } from '../utils/activity-layers';
import { NetworkIcon } from './NetworkIcon';
import { SectionHeader } from './SectionHeader';
import { ActivityDetailSheet } from './ActivityDetailSheet';
import {
    type ActivityItem,
    type ActivityItemType,
    type ActivityLayer,
    type AssetMeta,
} from '../services/ActivityService';
import { loadSwapAttemptActivity } from '../services/kaleidoPay/activity';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { ACTIVITY_STATUS_VISUAL } from '../utils/paymentStatus';
import { RGB_TRANSFER_STATUS_LABEL } from '../utils/rgb-wallet';

interface Props {
    onViewAll?: () => void;
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

function typeVisual(type: ActivityItemType): { icon: keyof typeof Ionicons.glyphMap; color: string } {
    switch (type) {
        case 'receive': return { icon: 'arrow-down', color: theme.colors.tx.receive };
        case 'send': return { icon: 'arrow-up', color: theme.colors.tx.sent };
        case 'swap': return { icon: 'swap-horizontal', color: theme.colors.tx.swap };
        case 'issuance': return { icon: 'add-circle-outline', color: theme.colors.accent[500] };
        case 'channel_open': return { icon: 'git-branch-outline', color: theme.colors.accent[500] };
        case 'channel_close': return { icon: 'close-circle-outline', color: theme.colors.warning[500] };
        default: return { icon: 'ellipse-outline', color: theme.colors.text.tertiary };
    }
}

function typeLabel(type: ActivityItemType): string {
    switch (type) {
        case 'receive': return 'Receive';
        case 'send': return 'Payment';
        case 'swap': return 'Swap';
        case 'issuance': return 'Issuance';
        case 'channel_open': return 'Channel Open';
        case 'channel_close': return 'Channel Close';
        default: return 'Transaction';
    }
}

function amountPrefix(type: ActivityItemType): string {
    if (type === 'receive' || type === 'issuance' || type === 'swap') return '+';
    if (type === 'send') return '−';
    return '';
}


const MAX_ITEMS = 4;

export const RecentActivityWidget: React.FC<Props> = ({ onViewAll, assetId, assetTicker, title = 'Activity', limit, style, refreshKey }) => {
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

    // Don't render the section if there's nothing to show after loading
    // (an asset's history says so instead).
    if (!loading && items.length === 0 && !assetId) return null;

    const renderRow = (item: ActivityItem) => {
        const v = typeVisual(item.type);
        const st = ACTIVITY_STATUS_VISUAL[item.status];
        const hasAmount = item.amount !== '';
        // Swaps net into the received asset, so colour them like an inflow.
        const isIncoming = item.type === 'receive' || item.type === 'issuance' || item.type === 'swap';
        // Swaps carry the full "X sats → Y USDB" route in assetName; show it as a
        // subtitle so the route is visible without crowding the amount column.
        const subtitle = item.type === 'swap' ? item.assetName
            : item.rgbTransfer && item.status === 'pending' ? RGB_TRANSFER_STATUS_LABEL[item.rgbTransfer.status] : undefined;

        return (
            <TouchableOpacity
                key={item.id}
                activeOpacity={0.7}
                style={styles.row}
                onPress={() => setSelected(item)}
            >
                <View style={[styles.iconWrap, { backgroundColor: v.color + '1A' }]}>
                    <Ionicons name={v.icon} size={18} color={v.color} />
                </View>

                <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{typeLabel(item.type)}</Text>
                    {subtitle ? (
                        <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
                    ) : null}
                    <View style={styles.rowMeta}>
                        <View style={styles.layerChip}>
                            {layerNetworkIcon(item.layer) && <NetworkIcon network={layerNetworkIcon(item.layer)!} size={11} />}
                            <Text style={styles.layerChipText}>{LAYER_LABEL[item.layer]}</Text>
                        </View>
                        <View style={[styles.statusDot, { backgroundColor: st.color }]} />
                        <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                </View>

                {hasAmount && (
                    <Text
                        style={[
                            styles.rowAmount,
                            { color: isIncoming ? theme.colors.tx.receive : theme.colors.text.primary },
                        ]}
                        numberOfLines={1}
                    >
                        {item.status === 'failed' ? '' : amountPrefix(item.type)}{item.amount} {item.assetTicker}
                    </Text>
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
                <View style={styles.loadingWrap}>
                    <ActivityIndicator size="small" color={theme.colors.primary[500]} />
                </View>
            ) : items.length === 0 ? (
                <Text style={styles.empty}>No activity for this asset yet.</Text>
            ) : (
                <View style={styles.list}>{items.map(renderRow)}</View>
            )}

            <ActivityDetailSheet onRefresh={feed.refresh} item={items.find(item => item.id === selected?.id) ?? selected} onClose={() => setSelected(null)} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginTop: theme.spacing[6],
        paddingHorizontal: theme.spacing[4],
    },
    sectionHeader: {
        marginBottom: theme.spacing[3],
    },
    loadingWrap: {
        paddingVertical: theme.spacing[6],
        alignItems: 'center',
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
    layerChipText: {
        fontSize: 10,
        fontWeight: '600',
        color: theme.colors.text.secondary,
    },
    statusDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '600',
    },
    rowAmount: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '700',
        flexShrink: 1,
        marginLeft: theme.spacing[2],
        textAlign: 'right',
    },
});

export default RecentActivityWidget;
