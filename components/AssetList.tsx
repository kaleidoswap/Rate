import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, protocolColor } from '../theme';
import { Card } from './Card';
import { AssetIcon } from './AssetIcon';
import { Badge } from './Badge';
import { SectionHeader } from './SectionHeader';
import { AmountText } from './AmountText';
import { formatAssetAmount, getAssetBaseUnitBalance, type AssetBalanceLike } from '../utils/assetAmount';

interface NiaAsset {
    asset_id: string;
    ticker: string;
    name: string;
    precision: number;
    balance: AssetBalanceLike;
    protocol?: 'RGB' | 'SPARK' | 'ARKADE';
}

interface AssetListProps {
    assets: NiaAsset[];
    onViewAll: () => void;
    onAssetPress: (asset: NiaAsset) => void;
    onIssueAsset: () => void;
}

// AssetIcon imported from ./AssetIcon

export const AssetList: React.FC<AssetListProps> = ({
    assets,
    onViewAll,
    onAssetPress,
    onIssueAsset,
}) => {
    return (
        <View style={styles.section}>
            <SectionHeader title="Assets" actionLabel="View All" onAction={onViewAll} />

            {assets.length === 0 ? (
                <Card style={styles.emptyCard}>
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIcon}>
                            <Ionicons name="layers-outline" size={28} color={theme.colors.gray[400]} />
                        </View>
                        <Text style={styles.emptyTitle}>No assets yet</Text>
                        <Text style={styles.emptyDescription}>
                            Your tokens and assets will appear here
                        </Text>
                    </View>
                </Card>
            ) : (
                <View style={styles.assetsVerticalContainer}>
                    {assets.slice(0, 3).map((asset) => (
                        <TouchableOpacity
                            key={asset.asset_id}
                            style={styles.assetVerticalCard}
                            onPress={() => onAssetPress(asset)}
                        >
                            <View style={styles.assetVerticalContent}>
                                <View style={styles.assetVerticalLeft}>
                                    <AssetIcon ticker={asset.ticker} protocol={asset.protocol} size={36} />
                                    <View style={styles.assetVerticalInfo}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <Text style={styles.assetVerticalTicker}>{asset.ticker}</Text>
                                            {asset.protocol && (
                                                <Badge label={asset.protocol} color={protocolColor(asset.protocol)} />
                                            )}
                                        </View>
                                        <Text style={styles.assetVerticalName}>{asset.name}</Text>
                                    </View>
                                </View>
                                <View style={styles.assetVerticalRight}>
                                    <AmountText style={styles.assetVerticalBalance}>
                                        {formatAssetAmount(getAssetBaseUnitBalance(asset.balance), asset.precision)}
                                    </AmountText>
                                    <Ionicons name="chevron-forward" size={16} color={theme.colors.gray[400]} />
                                </View>
                            </View>
                        </TouchableOpacity>
                    ))}
                    {assets.length > 3 && (
                        <TouchableOpacity
                            style={styles.viewMoreButton}
                            onPress={onViewAll}
                        >
                            <Text style={styles.viewMoreText}>View {assets.length - 3} more assets</Text>
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
    emptyButton: {
        minWidth: 120,
    },
    assetsVerticalContainer: {
        gap: theme.spacing[3],
    },
    assetVerticalCard: {
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing[3],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    assetVerticalContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    assetVerticalLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    assetIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.colors.primary[50],
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing[3],
    },
    assetIconImage: {
        width: 24,
        height: 24,
    },
    assetVerticalInfo: {
        justifyContent: 'center',
    },
    assetVerticalTicker: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    assetVerticalName: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.secondary,
    },
    assetVerticalRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    assetVerticalBalance: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
        marginRight: theme.spacing[2],
    },
    viewMoreButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: theme.spacing[2],
    },
    viewMoreText: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.primary[600],
        fontWeight: '500',
        marginRight: theme.spacing[1],
    },
});
