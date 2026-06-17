// components/ActivityDetailSheet.tsx
//
// Bottom-sheet modal for a single activity item. Shows full detail: amount,
// status, network layer, timestamp, fee, and a copyable txid/payment hash.
import React from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { CopyButton } from './CopyButton';
import type { ActivityItem, ActivityItemType, ActivityLayer } from '../services/ActivityService';
import { ACTIVITY_STATUS_VISUAL } from '../utils/paymentStatus';

interface Props {
    item: ActivityItem | null;
    onClose: () => void;
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

export const ActivityDetailSheet: React.FC<Props> = ({ item, onClose }) => {
    if (!item) return null;

    const v = typeVisual(item.type);
    const st = ACTIVITY_STATUS_VISUAL[item.status];
    const hasAmount = item.amount !== '';
    const isIncoming = item.type === 'receive' || item.type === 'issuance';
    const txLabel = item.source === 'payment' ? 'Payment hash' : 'Transaction ID';

    return (
        <Modal
            visible
            animationType="slide"
            presentationStyle="formSheet"
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <View style={styles.handle} />

                {/* Icon + type + amount */}
                <View style={styles.header}>
                    <View style={[styles.bigIcon, { backgroundColor: v.color + '1A' }]}>
                        <Ionicons name={v.icon} size={32} color={v.color} />
                    </View>
                    <Text style={styles.typeLabel}>{typeLabel(item)}</Text>
                    {hasAmount && (
                        <Text style={[styles.amount, { color: isIncoming ? theme.colors.success[500] : theme.colors.text.primary }]}>
                            {amountPrefix(item.type)}{item.amount} {item.assetTicker}
                        </Text>
                    )}
                </View>

                <ScrollView contentContainerStyle={styles.body}>
                    {/* Status */}
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>Status</Text>
                        <View style={styles.statusBadge}>
                            <View style={[styles.statusDot, { backgroundColor: st.color }]} />
                            <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                        </View>
                    </View>

                    {/* Network layer */}
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>Network</Text>
                        <View style={styles.layerChip}>
                            <Text style={styles.layerChipText}>{LAYER_LABEL[item.layer]}</Text>
                        </View>
                    </View>

                    {/* Asset name */}
                    {!!item.assetName && (
                        <View style={styles.row}>
                            <Text style={styles.rowLabel}>Asset</Text>
                            <Text style={styles.rowValue}>{item.assetName}</Text>
                        </View>
                    )}

                    {/* Timestamp */}
                    {item.timestamp != null && (
                        <View style={styles.row}>
                            <Text style={styles.rowLabel}>Date</Text>
                            <Text style={styles.rowValue}>
                                {new Date(item.timestamp).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </Text>
                        </View>
                    )}

                    {/* Fee */}
                    {item.fee != null && (
                        <View style={styles.row}>
                            <Text style={styles.rowLabel}>Fee</Text>
                            <Text style={styles.rowValue}>{item.fee} sats</Text>
                        </View>
                    )}

                    {/* Txid / payment hash */}
                    {!!item.txid && (
                        <View style={styles.txidBlock}>
                            <View style={styles.txidHeader}>
                                <Text style={styles.rowLabel}>{txLabel}</Text>
                                <CopyButton value={item.txid} label="Copy" size={14} />
                            </View>
                            <Text style={styles.txidText} selectable numberOfLines={3}>{item.txid}</Text>
                        </View>
                    )}
                </ScrollView>

                <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8}>
                    <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.primary,
        paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.border.medium,
        marginTop: theme.spacing[3],
        marginBottom: theme.spacing[2],
    },
    header: {
        alignItems: 'center',
        paddingVertical: theme.spacing[5],
        paddingHorizontal: theme.spacing[4],
        gap: theme.spacing[2],
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.light,
    },
    bigIcon: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: theme.spacing[1],
    },
    typeLabel: {
        fontSize: theme.typography.fontSize.xl,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    amount: {
        fontSize: theme.typography.fontSize['2xl'],
        fontWeight: '800',
    },
    body: {
        paddingHorizontal: theme.spacing[4],
        paddingTop: theme.spacing[3],
        gap: theme.spacing[2],
        paddingBottom: theme.spacing[4],
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing[4],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    rowLabel: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.secondary,
    },
    rowValue: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.primary,
        maxWidth: '60%',
        textAlign: 'right',
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusText: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '700',
    },
    layerChip: {
        paddingHorizontal: theme.spacing[2],
        paddingVertical: 3,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.surface.tertiary,
    },
    layerChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text.secondary,
    },
    txidBlock: {
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing[4],
        gap: theme.spacing[2],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    txidHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing[2],
    },
    txidText: {
        fontSize: 12,
        fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
        color: theme.colors.text.secondary,
        lineHeight: 18,
    },
    closeButton: {
        marginHorizontal: theme.spacing[4],
        marginTop: theme.spacing[2],
        paddingVertical: theme.spacing[4],
        borderRadius: theme.borderRadius.xl,
        backgroundColor: theme.colors.surface.secondary,
        alignItems: 'center',
    },
    closeButtonText: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
});

export default ActivityDetailSheet;
