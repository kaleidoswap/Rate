import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
            <SectionHeader title="Assets" eyebrow actionLabel="View All" onAction={onViewAll} />

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
                <View style={styles.assetsListWrapper}>
                <View style={styles.assetsVerticalContainer}>
                    {assets.slice(0, 3).map((asset) => {
                      // Per-asset accent gradient (extension parity): BTC → bitcoin
                      // orange, RGB/Spark/Arkade → their protocol color. Navy fills
                      // the left ~third, then fades into a muted accent on the right.
                      const accent =
                        asset.ticker === 'BTC'
                          ? theme.colors.networks.bitcoin
                          : protocolColor(asset.protocol);
                      return (
                        <TouchableOpacity
                            key={asset.asset_id}
                            style={styles.assetCardWrapper}
                            onPress={() => onAssetPress(asset)}
                        >
                          <LinearGradient
                            // Mirrors the extension exactly:
                            // linear-gradient(135deg, card 30%, accent@55 75%, accent@b3 100%)
                            colors={[
                              theme.colors.surface.primary,
                              theme.colors.surface.primary,
                              `${accent}55`,
                              `${accent}B3`,
                            ]}
                            locations={[0, 0.3, 0.75, 1]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.assetVerticalCard}
                          >
                            <View style={styles.assetVerticalContent}>
                                <View style={styles.assetVerticalLeft}>
                                    <AssetIcon ticker={asset.ticker} protocol={asset.protocol} size={36} />
                                    <View style={styles.assetVerticalInfo}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1.5] }}>
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
                          </LinearGradient>
                        </TouchableOpacity>
                      );
                    })}
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
                {assets.length > 2 && (
                    <View pointerEvents="none" style={styles.fadeOverlay}>
                        <LinearGradient
                            colors={[
                                `${theme.colors.background.primary}00`,
                                theme.colors.background.primary,
                            ]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            pointerEvents="none"
                            style={styles.fadeGradient}
                        />
                    </View>
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
    assetsListWrapper: {
        position: 'relative',
    },
    assetsVerticalContainer: {
        gap: theme.spacing[3],
    },
    fadeOverlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 130,
    },
    fadeGradient: {
        flex: 1,
    },
    assetCardWrapper: {
        // Clip the gradient to the rounded card shape. No border (extension parity).
        borderRadius: theme.borderRadius.xl,
        overflow: 'hidden',
    },
    assetVerticalCard: {
        padding: theme.spacing[3],
    },
    assetVerticalContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    assetVerticalLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[3],
        flex: 1,
        minWidth: 0,
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
