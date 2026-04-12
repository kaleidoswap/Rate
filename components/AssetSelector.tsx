/**
 * AssetSelector — modal for picking an asset with search, protocol badges, and category filters.
 * Matches rate-extension's asset selector pattern.
 */
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { AssetIcon } from './AssetIcon';

export interface SelectableAsset {
  asset_id: string;
  ticker: string;
  name: string;
  balance?: number;
  precision?: number;
  protocol?: 'RGB' | 'SPARK' | 'ARKADE';
  icon?: string;
  isRGB?: boolean;
}

interface AssetSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (asset: SelectableAsset) => void;
  assets: SelectableAsset[];
  selectedAssetId?: string;
  title?: string;
}

const PROTOCOL_BADGE: Record<string, { label: string; color: string }> = {
  RGB: { label: 'RGB', color: '#2BEE79' },
  SPARK: { label: 'Spark', color: '#60A5FA' },
  ARKADE: { label: 'Arkade', color: '#A855F7' },
};

export const AssetSelector: React.FC<AssetSelectorProps> = ({
  visible,
  onClose,
  onSelect,
  assets,
  selectedAssetId,
  title = 'Select Asset',
}) => {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return assets;
    const q = search.toLowerCase().trim();
    return assets.filter(a =>
      a.ticker.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.asset_id.toLowerCase().includes(q)
    );
  }, [assets, search]);

  const renderItem = ({ item }: { item: SelectableAsset }) => {
    const isSelected = item.asset_id === selectedAssetId;
    const badge = item.protocol ? PROTOCOL_BADGE[item.protocol] : null;

    return (
      <TouchableOpacity
        style={[styles.assetRow, isSelected && styles.assetRowSelected]}
        onPress={() => { onSelect(item); onClose(); }}
        activeOpacity={0.6}
      >
        <AssetIcon
          ticker={item.ticker}
          logoUri={item.icon}
          protocol={item.protocol}
          size={40}
          showBadge={!!item.protocol}
        />

        <View style={styles.assetInfo}>
          <View style={styles.assetTopRow}>
            <Text style={styles.assetTicker}>{item.ticker}</Text>
            {badge && (
              <View style={[styles.protocolBadge, { backgroundColor: badge.color + '18' }]}>
                <Text style={[styles.protocolBadgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            )}
            {isSelected && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>Current</Text>
              </View>
            )}
          </View>
          <Text style={styles.assetName} numberOfLines={1}>{item.name}</Text>
        </View>

        {item.balance !== undefined && (
          <Text style={styles.assetBalance}>
            {item.balance.toLocaleString(undefined, { maximumFractionDigits: item.precision || 8 })}
          </Text>
        )}

        <Ionicons name="chevron-forward" size={16} color={theme.colors.gray[300]} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={theme.colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={theme.colors.gray[400]} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search assets..."
            placeholderTextColor={theme.colors.gray[400]}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={theme.colors.gray[400]} />
            </TouchableOpacity>
          )}
        </View>

        {/* Asset list */}
        <FlatList
          data={filtered}
          keyExtractor={item => item.asset_id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={32} color={theme.colors.gray[300]} />
              <Text style={styles.emptyText}>No assets found</Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background.secondary,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: theme.colors.text.primary,
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 40,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 2,
  },
  assetRowSelected: {
    backgroundColor: theme.colors.primary[500] + '10',
    borderWidth: 1,
    borderColor: theme.colors.primary[500] + '25',
  },
  assetInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  assetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assetTicker: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  assetName: {
    fontSize: 12,
    color: theme.colors.text.tertiary,
    marginTop: 2,
  },
  assetBalance: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },
  protocolBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  protocolBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  currentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.primary[500] + '15',
  },
  currentBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: theme.colors.primary[500],
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.gray[400],
    marginTop: 8,
  },
});

export default AssetSelector;
