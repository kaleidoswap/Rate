import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    SectionList,
    TouchableOpacity,
    RefreshControl,
    StatusBar,
    ActivityIndicator,
} from 'react-native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { RootState } from '../store';
import { MainHeader, SegmentedTabs } from '../components';
import { EmptyState } from '../components/EmptyState';
import { theme } from '../theme';
import {
    loadActivity,
    type ActivityItem,
    type ActivityItemType,
    type ActivityLayer,
    type ActivityStatus,
    type AssetMeta,
} from '../services/ActivityService';
import { ACTIVITY_STATUS_VISUAL } from '../utils/paymentStatus';
import { ActivityDetailSheet } from '../components/ActivityDetailSheet';

type FilterTab = 'all' | 'receive' | 'send' | 'swap';

const FILTERS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'receive', label: 'Received' },
    { key: 'send', label: 'Sent' },
    { key: 'swap', label: 'Swaps' },
];

// Per-type visual identity: icon + accent colour.
function typeVisual(type: ActivityItemType): { icon: keyof typeof Ionicons.glyphMap; color: string } {
    switch (type) {
        case 'receive':
            return { icon: 'arrow-down', color: theme.colors.success[500] };
        case 'send':
            return { icon: 'arrow-up', color: theme.colors.error[500] };
        case 'swap':
            return { icon: 'swap-horizontal', color: '#A78BFA' };
        case 'issuance':
            return { icon: 'add-circle-outline', color: theme.colors.accent[500] };
        case 'channel_open':
            return { icon: 'git-branch-outline', color: theme.colors.accent[500] };
        case 'channel_close':
            return { icon: 'close-circle-outline', color: theme.colors.warning[500] };
        default:
            return { icon: 'ellipse-outline', color: theme.colors.text.tertiary };
    }
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

function typeLabel(item: ActivityItem): string {
    switch (item.type) {
        case 'receive': return 'Received';
        case 'send': return 'Sent';
        case 'swap': return 'Atomic Swap';
        case 'issuance': return item.kind === 'Inflation' ? 'Inflation' : 'Issuance';
        case 'channel_open': return 'Channel Open';
        case 'channel_close': return 'Channel Close';
        default: return 'Transaction';
    }
}

// Status → label/color now lives in utils/paymentStatus (single source of truth).
const statusVisual = ACTIVITY_STATUS_VISUAL;

function amountPrefix(type: ActivityItemType): string {
    if (type === 'receive' || type === 'issuance') return '+';
    if (type === 'send') return '−';
    return '';
}

// Group items by relative day for section headers.
function sectionTitle(ts?: number): string {
    if (!ts) return 'Earlier';
    const d = new Date(ts);
    const now = new Date();
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function HistoryScreen() {
    const navigation = useNavigation<any>();
    const swapHistory = useSelector((state: RootState) => state.swap.swapHistory);
    const rgbAssets = useSelector((state: RootState) => state.assets.rgbAssets);

    const [items, setItems] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [softError, setSoftError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterTab>('all');
    const [selectedItem, setSelectedItem] = useState<ActivityItem | null>(null);

    const fetchActivity = useCallback(async () => {
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
            const { items: result, failedSources, hadConnectedAdapter } = await loadActivity({ assets, swaps });
            setItems(result);
            if (!hadConnectedAdapter && result.length === 0) {
                setSoftError('Wallet is offline. Connect a protocol to see your activity.');
            } else if (failedSources > 0 && result.length === 0) {
                setSoftError('Could not load some activity. Pull to refresh.');
            } else {
                setSoftError(null);
            }
        } catch (e: any) {
            setSoftError(e?.message || 'Failed to load activity.');
        }
    }, [rgbAssets, swapHistory]);

    useEffect(() => {
        setLoading(true);
        fetchActivity().finally(() => setLoading(false));
    }, [fetchActivity]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchActivity();
        setRefreshing(false);
    }, [fetchActivity]);

    const filtered = items.filter((it) => {
        if (filter === 'all') return true;
        if (filter === 'swap') return it.type === 'swap';
        return it.type === filter;
    });

    // Build sections grouped by day.
    const sections = (() => {
        const map = new Map<string, ActivityItem[]>();
        for (const it of filtered) {
            const key = sectionTitle(it.timestamp);
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(it);
        }
        return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
    })();

    const renderItem = ({ item }: { item: ActivityItem }) => {
        const v = typeVisual(item.type);
        const st = statusVisual[item.status];
        const hasAmount = item.amount !== '';
        return (
            <TouchableOpacity activeOpacity={0.7} style={styles.row} onPress={() => setSelectedItem(item)}>
                <View style={[styles.iconWrap, { backgroundColor: v.color + '1A' }]}>
                    <Ionicons name={v.icon} size={20} color={v.color} />
                </View>

                <View style={styles.rowBody}>
                    <View style={styles.rowTopLine}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{typeLabel(item)}</Text>
                        {hasAmount && (
                            <Text
                                style={[
                                    styles.rowAmount,
                                    { color: item.type === 'receive' || item.type === 'issuance' ? theme.colors.success[500] : theme.colors.text.primary },
                                ]}
                                numberOfLines={1}
                            >
                                {amountPrefix(item.type)}{item.amount} {item.assetTicker}
                            </Text>
                        )}
                    </View>
                    <View style={styles.rowBottomLine}>
                        <View style={styles.metaRow}>
                            <View style={styles.layerChip}>
                                <Text style={styles.layerChipText}>{LAYER_LABEL[item.layer]}</Text>
                            </View>
                            {item.timestamp != null && (
                                <Text style={styles.timeText}>
                                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            )}
                        </View>
                        <View style={styles.statusRow}>
                            <View style={[styles.statusDot, { backgroundColor: st.color }]} />
                            <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            <MainHeader title="Activity" onBack={() => navigation.goBack()} />

            {/* Filter tabs */}
            <SegmentedTabs
                options={FILTERS}
                value={filter}
                onChange={(key) => setFilter(key)}
                scrollable={false}
                style={styles.filterBar}
            />

            {softError && (
                <View style={styles.errorBanner}>
                    <Ionicons name="cloud-offline-outline" size={16} color={theme.colors.warning[500]} />
                    <Text style={styles.errorBannerText}>{softError}</Text>
                </View>
            )}

            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator color={theme.colors.primary[500]} />
                    <Text style={styles.loadingText}>Loading activity…</Text>
                </View>
            ) : (
                <SectionList
                    sections={sections}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    renderSectionHeader={({ section }) => (
                        <Text style={styles.sectionHeader}>{section.title}</Text>
                    )}
                    stickySectionHeadersEnabled={false}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary[500]} />
                    }
                    ListEmptyComponent={
                        <EmptyState
                            icon="receipt-outline"
                            title="No activity yet"
                            message="Your payments, transfers and swaps will appear here once you send or receive."
                        />
                    }
                />
            )}

            <ActivityDetailSheet item={selectedItem} onClose={() => setSelectedItem(null)} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.secondary,
    },
    filterBar: {
        paddingHorizontal: theme.spacing[4],
        paddingTop: theme.spacing[3],
        paddingBottom: theme.spacing[2],
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
        marginHorizontal: theme.spacing[4],
        marginTop: theme.spacing[2],
        padding: theme.spacing[3],
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.warning[50],
        borderWidth: 1,
        borderColor: theme.colors.warning[100],
    },
    errorBannerText: {
        flex: 1,
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
    },
    loadingWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing[3],
    },
    loadingText: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.fontSize.sm,
    },
    listContent: {
        paddingHorizontal: theme.spacing[4],
        paddingBottom: theme.spacing[10],
        flexGrow: 1,
    },
    sectionHeader: {
        fontSize: theme.typography.fontSize.xs,
        fontWeight: '700',
        color: theme.colors.text.tertiary,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginTop: theme.spacing[4],
        marginBottom: theme.spacing[2],
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
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: theme.spacing[3],
    },
    rowBody: {
        flex: 1,
        gap: 4,
    },
    rowTopLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.spacing[2],
    },
    rowTitle: {
        flex: 1,
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    rowAmount: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '700',
    },
    rowBottomLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
    },
    layerChip: {
        paddingHorizontal: theme.spacing[2],
        paddingVertical: 2,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.surface.tertiary,
    },
    layerChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: theme.colors.text.secondary,
    },
    timeText: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.tertiary,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusText: {
        fontSize: theme.typography.fontSize.xs,
        fontWeight: '600',
    },
});
