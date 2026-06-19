import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { Card } from './Card';
import { Button } from './Button';

interface Channel {
    channel_id: string;
    peer_alias: string;
    peer_pubkey: string;
    is_usable: boolean;
    ready: boolean;
    capacity_sat: number;
    outbound_balance_msat: number;
    inbound_balance_msat: number;
}

interface ChannelListProps {
    channels: Channel[];
    bitcoinUnit: string;
    formatSatoshis: (amount: number) => string;
    onViewAll: () => void;
    onChannelPress: (channel: Channel) => void;
    onOpenChannel: () => void;
    onBuyChannel: () => void;
}

export const ChannelList: React.FC<ChannelListProps> = ({
    channels,
    bitcoinUnit,
    formatSatoshis,
    onViewAll,
    onChannelPress,
    onOpenChannel,
    onBuyChannel,
}) => {
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Lightning Channels</Text>
                <TouchableOpacity onPress={onViewAll}>
                    <Text style={styles.sectionAction}>View All</Text>
                </TouchableOpacity>
            </View>

            {channels.length === 0 ? (
                <Card style={styles.emptyCard}>
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIcon}>
                            <Ionicons name="flash-outline" size={28} color={theme.colors.gray[400]} />
                        </View>
                        <Text style={styles.emptyTitle}>No channels yet</Text>
                        <Text style={styles.emptyDescription}>
                            Open your first Lightning channel to start transacting
                        </Text>
                        <View style={styles.emptyActions}>
                            <Button
                                title="Open Channel"
                                variant="secondary"
                                size="sm"
                                onPress={onOpenChannel}
                                style={styles.emptyButton}
                            />
                            <Button
                                title="Buy Channel"
                                variant="primary"
                                size="sm"
                                onPress={onBuyChannel}
                                style={styles.emptyButton}
                            />
                        </View>
                    </View>
                </Card>
            ) : (
                <View style={styles.channelsVerticalContainer}>
                    {channels.slice(0, 3).map((channel) => (
                        <TouchableOpacity
                            key={channel.channel_id}
                            style={styles.channelVerticalCard}
                            onPress={() => onChannelPress(channel)}
                        >
                            <View style={styles.channelVerticalContent}>
                                <View style={styles.channelVerticalLeft}>
                                    <View style={styles.channelVerticalStatus}>
                                        <View style={[
                                            styles.channelVerticalStatusDot,
                                            { backgroundColor: channel.is_usable ? theme.colors.success[500] : theme.colors.error[500] }
                                        ]} />
                                        <View style={styles.channelVerticalInfo}>
                                            <Text style={styles.channelVerticalPeerName} numberOfLines={1}>
                                                {channel.peer_alias || channel.peer_pubkey.slice(0, 8)}
                                            </Text>
                                            <View style={styles.channelVerticalStatusRow}>
                                                <Text style={[
                                                    styles.channelVerticalStatusText,
                                                    { color: channel.ready ? theme.colors.success[500] : theme.colors.warning[500] }
                                                ]}>
                                                    {channel.ready ? 'Open' : 'Pending'}
                                                </Text>
                                                <Text style={styles.channelVerticalCapacity}>
                                                    {formatSatoshis(channel.capacity_sat)} {bitcoinUnit}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                </View>
                                <View style={styles.channelVerticalRight}>
                                    <View style={styles.channelVerticalTopRow}>
                                        <View style={styles.channelVerticalLiquidity}>
                                            <View style={styles.liquidityVerticalRow}>
                                                <View style={styles.liquidityVerticalItem}>
                                                    <Ionicons name="arrow-up" size={10} color={theme.colors.success[500]} />
                                                    <Text style={styles.liquidityVerticalAmount}>
                                                        {formatSatoshis(channel.outbound_balance_msat / 1000)}
                                                    </Text>
                                                </View>
                                                <View style={styles.liquidityVerticalItem}>
                                                    <Ionicons name="arrow-down" size={10} color={theme.colors.primary[500]} />
                                                    <Text style={styles.liquidityVerticalAmount}>
                                                        {formatSatoshis(channel.inbound_balance_msat / 1000)}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={styles.liquidityVerticalBar}>
                                                <View style={[
                                                    styles.liquidityVerticalBarFill,
                                                    {
                                                        width: `${(channel.outbound_balance_msat + channel.inbound_balance_msat) > 0 ?
                                                            (channel.outbound_balance_msat / (channel.outbound_balance_msat + channel.inbound_balance_msat) * 100) : 0}%`,
                                                        backgroundColor: theme.colors.success[500]
                                                    }
                                                ]} />
                                            </View>
                                        </View>
                                        <Ionicons name="chevron-forward" size={14} color={theme.colors.gray[400]} />
                                    </View>
                                </View>
                            </View>
                        </TouchableOpacity>
                    ))}
                    {channels.length > 3 && (
                        <TouchableOpacity
                            style={styles.viewMoreButton}
                            onPress={onViewAll}
                        >
                            <Text style={styles.viewMoreText}>View {channels.length - 3} more channels</Text>
                            <Ionicons name="chevron-forward" size={16} color={theme.colors.primary[500]} />
                        </TouchableOpacity>
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
        marginBottom: theme.spacing[8],
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing[3],
    },
    sectionTitle: {
        fontSize: theme.typography.fontSize.lg,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    sectionAction: {
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
        backgroundColor: theme.colors.gray[100],
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
        marginBottom: theme.spacing[4],
    },
    emptyActions: {
        flexDirection: 'row',
        gap: theme.spacing[3],
    },
    emptyButton: {
        minWidth: 120,
    },
    channelsVerticalContainer: {
        gap: theme.spacing[3],
    },
    channelVerticalCard: {
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing[3],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    channelVerticalContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    channelVerticalLeft: {
        flex: 1,
        marginRight: theme.spacing[3],
    },
    channelVerticalStatus: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    channelVerticalStatusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: theme.spacing[3],
    },
    channelVerticalInfo: {
        flex: 1,
    },
    channelVerticalPeerName: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
        marginBottom: 2,
    },
    channelVerticalStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
    },
    channelVerticalStatusText: {
        fontSize: theme.typography.fontSize.xs,
        fontWeight: '500',
    },
    channelVerticalCapacity: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.tertiary,
    },
    channelVerticalRight: {
        alignItems: 'flex-end',
    },
    channelVerticalTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    channelVerticalLiquidity: {
        marginRight: theme.spacing[2],
        width: 100,
    },
    liquidityVerticalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    liquidityVerticalItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    liquidityVerticalAmount: {
        fontSize: 10,
        color: theme.colors.text.secondary,
        fontWeight: '500',
    },
    liquidityVerticalBar: {
        height: 4,
        backgroundColor: theme.colors.gray[200],
        borderRadius: 2,
        overflow: 'hidden',
    },
    liquidityVerticalBarFill: {
        height: '100%',
        borderRadius: 2,
    },
    viewMoreButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: theme.spacing[2],
    },
    viewMoreText: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.primary[500],
        fontWeight: '500',
        marginRight: theme.spacing[1],
    },
});
