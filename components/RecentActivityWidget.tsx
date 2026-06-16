// components/RecentActivityWidget.tsx
//
// Dashboard snippet: shows the last 3 activity items with a "View All" link.
// Tapping a row opens the ActivityDetailSheet inline.
import React, { useState, useEffect, useCallback } from 'react';
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
        case 'receive': return { icon: 'arrow-down', color: theme.colors.success[500] };
        case 'send': return { icon: 'arrow-up', color: theme.colors.error[500] };
        case 'swap': return { icon: 'swap-horizontal', color: '#A78BFA' };
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
    if (type === 'receive' || type === 'issuance') return '+';
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

const MAX_ITEMS = 3;

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

    useEffect(() => {
        setLoading(true);
        fetchRecent().finally(() => setLoading(false));
    }, [fetchRecent]);

    // Refresh when the Dashboard tab regains focus.
    useFocusEffect(
        useCallback(() => {
            fetchRecent();
        }, [fetchRecent])
    );

    // Don't render the section if there's nothing to show after loading.
    if (!loading && items.length === 0) return null;

    return (
        <View style={styles.container}>
            <SectionHeader
                title="Recent Activity"
                actionLabel="View All"
                onAction={onViewAll}
                style={styles.sectionHeader}
            />

            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator size="small" color={theme.colors.primary[500]} />
                </View>
            ) : (
                items.map((item) => {
                    const v = typeVisual(item.type);
                    const st = ACTIVITY_STATUS_VISUAL[item.status];
                    const hasAmount = item.amount !== '';
                    const isIncoming = item.type === 'receive' || item.type === 'issuance';

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
                                        { color: isIncoming ? theme.colors.success[500] : theme.colors.text.primary },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {amountPrefix(item.type)}{item.amount} {item.assetTicker}
                                </Text>
                            )}
                        </TouchableOpacity>
                    );
                })
            )}

            <ActivityDetailSheet item={selected} onClose={() => setSelected(null)} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginTop: theme.spacing[6],
        marginHorizontal: theme.spacing[4],
    },
    sectionHeader: {
        marginBottom: theme.spacing[3],
    },
    loadingWrap: {
        paddingVertical: theme.spacing[6],
        alignItems: 'center',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing[3],
        marginBottom: theme.spacing[2],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
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
