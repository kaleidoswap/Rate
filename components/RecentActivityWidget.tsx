// components/RecentActivityWidget.tsx
//
// Dashboard snippet: shows the last 3 activity items with a "View All" link.
// Tapping a row opens the ActivityDetailSheet inline.
import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import { theme } from '../theme';
import { SectionHeader } from './SectionHeader';
import { ActivityDetailSheet } from './ActivityDetailSheet';
import {
    loadActivity,
    type ActivityItem,
    type ActivityItemType,
    type ActivityLayer,
    type AssetMeta,
} from '../services/ActivityService';
import { ACTIVITY_STATUS_VISUAL } from '../utils/paymentStatus';

interface Props {
    onViewAll: () => void;
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
        case 'receive': return 'Received';
        case 'send': return 'Sent';
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

const LAYER_LABEL: Record<ActivityLayer, string> = {
    'L1': 'On-chain',
    'RGB-L1': 'RGB',
    'LN': 'Lightning',
    'RGB-LN': 'RGB · LN',
    'Spark': 'Spark',
    'Arkade': 'Arkade',
    'Swap': 'Swap',
};

const MAX_ITEMS = 2;

export const RecentActivityWidget: React.FC<Props> = ({ onViewAll }) => {
    const swapHistory = useSelector((state: RootState) => state.swap.swapHistory);
    const rgbAssets = useSelector((state: RootState) => state.assets.rgbAssets);

    const [items, setItems] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<ActivityItem | null>(null);

    const fetchRecent = useCallback(async () => {
        const assets: AssetMeta[] = (rgbAssets || []).map((a: any) => ({
            asset_id: a.asset_id,
            ticker: a.ticker,
            name: a.name,
            precision: a.precision ?? 0,
            protocol: a.protocol,
        }));
        const swaps = (swapHistory || []).map((s: any) => ({
            rfq_id: s.rfq_id,
            status: s.status,
            created_at: s.created_at,
            txid: s.txid,
            from_asset: s.from_asset,
            to_asset: s.to_asset,
            from_amount: s.from_amount,
            to_amount: s.to_amount,
            venue: s.venue,
        }));
        try {
            const { items: result } = await loadActivity({ assets, swaps });
            setItems(result.slice(0, MAX_ITEMS));
        } catch {
            // Non-critical widget — fail silently.
        }
    }, [rgbAssets, swapHistory]);

    // Refresh when the Dashboard tab regains focus.
    useFocusEffect(
        useCallback(() => {
            let active = true;
            setLoading(true);
            fetchRecent().finally(() => {
                if (active) setLoading(false);
            });
            return () => {
                active = false;
            };
        }, [fetchRecent])
    );

    // Don't render the section if there's nothing to show after loading.
    if (!loading && items.length === 0) return null;

    const renderRow = (item: ActivityItem) => {
        const v = typeVisual(item.type);
        const st = ACTIVITY_STATUS_VISUAL[item.status];
        const hasAmount = item.amount !== '';
        // Swaps net into the received asset, so colour them like an inflow.
        const isIncoming = item.type === 'receive' || item.type === 'issuance' || item.type === 'swap';
        // Swaps carry the full "X sats → Y USDB" route in assetName; show it as a
        // subtitle so the route is visible without crowding the amount column.
        const subtitle = item.type === 'swap' ? item.assetName : undefined;

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
                        {amountPrefix(item.type)}{item.amount} {item.assetTicker}
                    </Text>
                )}
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <SectionHeader
                title="Activity"
                eyebrow
                actionLabel="View All"
                onAction={onViewAll}
                style={styles.sectionHeader}
            />

            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator size="small" color={theme.colors.primary[500]} />
                </View>
            ) : (
                <View>
                    {/* First item shows in full; everything from the second down
                        fades into the page background as a "there's more" teaser. */}
                    {renderRow(items[0])}
                    {items.length > 1 && (
                        <View style={styles.restWrap}>
                            <View style={styles.list}>
                                {items.slice(1).map(renderRow)}
                            </View>
                            <LinearGradient
                                colors={[`${theme.colors.background.primary}00`, theme.colors.background.primary]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                pointerEvents="none"
                                style={StyleSheet.absoluteFill}
                            />
                        </View>
                    )}
                </View>
            )}

            <ActivityDetailSheet item={selected} onClose={() => setSelected(null)} />
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
