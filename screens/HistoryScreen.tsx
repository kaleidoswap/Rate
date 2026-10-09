import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useAppSelector } from '../store/hooks';
import { usePolicy } from '../hooks/usePolicy';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { RootState } from '../store';
import { MainHeader, SegmentedTabs } from '../components';
import { EmptyState } from '../components/EmptyState';
import { theme } from '../theme';
import {
    ACTIVITY_NETWORK_LABEL,
    LAYER_LABEL,
    activityNetworks,
    layerNetworkIcon,
    matchesActivityFilter,
    type ActivityNetwork,
    type ActivityTab,
} from '../utils/activity-layers';
import { NetworkIcon } from '../components/NetworkIcon';
import {
    type ActivityItem,
    type ActivityItemType,
    type ActivityLayer,
    type ActivityStatus,
    type AssetMeta,
} from '../services/ActivityService';
import { loadPendingPaymentActivity, loadSwapAttemptActivity, PAYMENT_ATTEMPT_KIND } from '../services/kaleidoPay/activity';
import { ACTIVITY_STATUS_VISUAL } from '../utils/paymentStatus';
import { ActivityDetailSheet } from '../components/ActivityDetailSheet';
import { AgentWalletStore, type AgentLedgerEntry } from '../services/agentWallet/store';
import { AGENT_ACTIVITY_KIND, agentActivityItems } from '../services/agentWallet/activity';

const FILTERS: { key: ActivityTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'In progress' },
    { key: 'receive', label: 'Received' },
    { key: 'send', label: 'Sent' },
    { key: 'swap', label: 'Swaps' },
    { key: 'agent', label: 'Agent' },
];

// Per-type visual identity: icon + accent colour. Direction colours come from
// the shared `tx` tokens (sent/receive/swap) so the activity feed matches web.
function typeVisual(type: ActivityItemType): { icon: keyof typeof Ionicons.glyphMap; color: string } {
    switch (type) {
        case 'receive':
            return { icon: 'arrow-down', color: theme.colors.tx.receive };
        case 'send':
            return { icon: 'arrow-up', color: theme.colors.tx.sent };
        case 'swap':
            return { icon: 'swap-horizontal', color: theme.colors.tx.swap };
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


// Map an activity layer to a per-network chip colour pair (background + text)
// sourced from the shared kaleido-ui tokens, so the chips stay contrast-safe
// and match the web. Layers without a network token fall back to the neutral
// surface chip.
function layerChipColors(layer: ActivityLayer): { bg: string; text: string } {
    switch (layer) {
        case 'L1':
            return { bg: theme.colors.networkChip.bitcoin, text: theme.colors.networkText.bitcoin };
        case 'RGB-L1':
        case 'RGB-LN':
            return { bg: theme.colors.networkChip.rgb, text: theme.colors.networkText.rgb };
        case 'LN':
            return { bg: theme.colors.networkChip.lightning, text: theme.colors.networkText.lightning };
        case 'Spark':
            return { bg: theme.colors.networkChip.spark, text: theme.colors.networkText.spark };
        case 'Arkade':
            return { bg: theme.colors.networkChip.arkade, text: theme.colors.networkText.arkade };
        default:
            return { bg: theme.colors.surface.tertiary, text: theme.colors.text.secondary };
    }
}

function typeLabel(item: ActivityItem): string {
    if (item.kind === AGENT_ACTIVITY_KIND && item.assetName) return item.assetName;
    switch (item.type) {
        case 'receive': return 'Receive';
        case 'send': return 'Payment';
        case 'swap': return 'Swap';
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
    const policy = usePolicy();
    const swapHistory = useAppSelector((state: RootState) => state.swap.swapHistory);
    const rgbAssets = useAppSelector((state: RootState) => state.assets.rgbAssets);
    const walletId = useAppSelector((state: RootState) => state.wallet.activeWallet?.id);

    const [pendingPayment, setPendingPayment] = useState<ActivityItem[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<ActivityTab>('all');
    const [network, setNetwork] = useState<ActivityNetwork | 'all'>('all');
    const [selectedItem, setSelectedItem] = useState<ActivityItem | null>(null);

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
    const feed = useActivityFeed(feedOptions, 15000);
    const { result } = feed;

    // A payment still being checked sits in the history like any other pending item.
    useEffect(() => {
        let active = true;
        loadPendingPaymentActivity(walletId).then((list) => { if (active) setPendingPayment(list); }, () => {});
        return () => { active = false; };
    }, [walletId, result]);

    // The Agent wallet is not a protocol account: its log is read here. Top-ups and
    // withdrawals already show as the main wallet's Spark transfers, so only the
    // Agent tab lists them.
    const [agentEntries, setAgentEntries] = useState<AgentLedgerEntry[]>([]);
    useEffect(() => {
        let active = true;
        if (!walletId) { setAgentEntries([]); return; }
        new AgentWalletStore(walletId).entries().then((list) => { if (active) setAgentEntries(list); }, () => {});
        return () => { active = false; };
    }, [walletId, result]);

    const items = useMemo(() => [...pendingPayment, ...feed.items, ...agentActivityItems(agentEntries, { spendsOnly: true })], [pendingPayment, feed.items, agentEntries]);
    const agentItems = useMemo(() => agentActivityItems(agentEntries), [agentEntries]);
    const loadingFirst = feed.updating && items.length === 0;

    const softError = useMemo(() => {
        if (!result) return null;
        if (!result.hadConnectedAdapter && result.items.length === 0) return 'Wallet is offline. Connect a protocol to see your activity.';
        if (result.failedSources > 0) return 'Some accounts could not be checked. Pull to refresh.';
        return null;
    }, [result]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await feed.refresh();
        setRefreshing(false);
    }, [feed.refresh]);

    // Which network a payment used is Advanced detail: Lite has no network filter.
    const networks = useMemo(() => (policy.showNetworks ? activityNetworks(items) : []), [items, policy.showNetworks]);
    const activeNetwork = networks.includes(network as ActivityNetwork) ? network : 'all';
    const networkOptions = useMemo(() => [
        { key: 'all' as const, label: 'All networks' },
        ...networks.map((n) => ({
            key: n,
            label: ACTIVITY_NETWORK_LABEL[n],
            renderIcon: (_color: string, size: number) => <NetworkIcon network={n} size={size} />,
        })),
    ], [networks]);

    const filtered = (filter === 'agent' ? agentItems : items)
        .filter((it) => matchesActivityFilter(it, filter, activeNetwork))
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    // Build sections grouped by day.
    const sections = (() => {
        const map = new Map<string, ActivityItem[]>();
        for (const it of filtered) {
            const key = it.status === 'unknown' ? 'Needs checking' : it.status === 'pending' ? 'In progress' : sectionTitle(it.timestamp);
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(it);
        }
        return Array.from(map.entries()).sort(([a], [b]) => ({ 'Needs checking': 0, 'In progress': 1 }[a] ?? 2) - ({ 'Needs checking': 0, 'In progress': 1 }[b] ?? 2)).map(([title, data]) => ({ title, data }));
    })();

    const renderItem = ({ item }: { item: ActivityItem }) => {
        const v = typeVisual(item.type);
        const st = statusVisual[item.status];
        const chip = layerChipColors(item.layer);
        const hasAmount = item.amount !== '';
        return (
            <TouchableOpacity activeOpacity={0.7} style={styles.row} onPress={() => item.kind === PAYMENT_ATTEMPT_KIND ? navigation.navigate('Send', { resumePayment: true }) : setSelectedItem(item)}>
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
                                    { color: item.type === 'receive' || item.type === 'issuance' ? theme.colors.tx.receive : theme.colors.text.primary },
                                ]}
                                numberOfLines={1}
                            >
                                {item.status === 'failed' ? '' : amountPrefix(item.type)}{item.amount} {item.assetTicker}
                            </Text>
                        )}
                    </View>
                    <View style={styles.rowBottomLine}>
                        <View style={styles.metaRow}>
                            {/* Which network a payment used is Advanced detail. */}
                            {policy.showNetworks && (
                                <View style={[styles.layerChip, { backgroundColor: chip.bg }]}>
                                    {layerNetworkIcon(item.layer) && <NetworkIcon network={layerNetworkIcon(item.layer)!} size={12} />}
                                    <Text style={[styles.layerChipText, { color: chip.text }]}>{LAYER_LABEL[item.layer]}</Text>
                                </View>
                            )}
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
            <MainHeader title="Activity" />

            {/* Filter tabs */}
            <SegmentedTabs
                options={FILTERS}
                value={filter}
                onChange={(key) => setFilter(key)}
                scrollable
                style={styles.filterBar}
            />
            {networks.length > 1 && (
                <SegmentedTabs<ActivityNetwork | 'all'>
                    options={networkOptions}
                    value={activeNetwork}
                    onChange={setNetwork}
                    scrollable
                    style={styles.networkBar}
                />
            )}

            {softError && (
                <View style={styles.errorBanner}>
                    <Ionicons name="cloud-offline-outline" size={16} color={theme.colors.warning[500]} />
                    <Text style={styles.errorBannerText}>{softError}</Text>
                </View>
            )}

            {feed.updating && !refreshing && items.length > 0 && (
                <View style={styles.updatingRow}>
                    <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
                    <Text style={styles.loadingText}>Updating…</Text>
                </View>
            )}

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
                    ListEmptyComponent={loadingFirst ? (
                        <View style={styles.loadingWrap}>
                            <ActivityIndicator color={theme.colors.primary[500]} />
                            <Text style={styles.loadingText}>Loading activity…</Text>
                        </View>
                    ) : (
                        <EmptyState
                            icon="receipt-outline"
                            title={filter === 'pending' ? 'No pending payments' : filter === 'agent' ? 'No agent payments yet' : 'No activity yet'}
                            message={filter === 'pending' ? 'Payments waiting for confirmation or needing a check appear here.' : filter === 'agent' ? 'What the assistant pays from its Agent wallet, and your top-ups, appear here.' : 'Your payments and transfers will appear here.'}
                        />
                    )}
                />

            <ActivityDetailSheet onRefresh={feed.refresh} item={items.find(item => item.id === selectedItem?.id) ?? selectedItem} onClose={() => setSelectedItem(null)} />
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
    networkBar: {
        paddingHorizontal: theme.spacing[4],
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
    updatingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing[2],
        paddingVertical: theme.spacing[1],
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
        gap: theme.spacing[1],
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
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
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
